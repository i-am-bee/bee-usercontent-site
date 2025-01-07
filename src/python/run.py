import ast
import asyncio
import functools
import importlib
import inspect
import json
import pathlib
import re
import sys
import traceback
import typing
import uuid
import warnings

import js
import micropip
import pyodide
import pyodide.ffi

import pydantic
import streamlit as st


warnings.filterwarnings("ignore")
CONFIG = json.loads(pathlib.Path(__file__).parent.resolve().joinpath("config.json").read_text())


def _escape_code_block(s):
    longest_backtick_group_length = max(
        (len(match) for match in re.findall(r"`+", s)), default=0
    )
    target_backtick_count = max(longest_backtick_group_length + 1, 3)
    backticks = "`" * target_backtick_count
    return f"{backticks}\n{s}\n{backticks}"


class UnfixableException(Exception):
    pass


def request(request_type: str, payload: typing.Any) -> asyncio.Future:
    future = asyncio.Future()
    request_id = str(uuid.uuid4())

    def handle_response(event):
        if event.data.type != "bee:response" or event.data.request_id != request_id:
            return
        future.set_result(event.data.payload)
        js.removeEventListener("message", handler)

    handler = pyodide.ffi.create_proxy(handle_response)
    js.addEventListener("message", handler)
    js.postMessage(json.dumps({
        "type": "bee:request",
        "request_id": request_id,
        "request_type": request_type,
        "payload": payload
    }))
    return future


def llm_function(creative=False):
    def _llm_function(func):
        if not func.__doc__:
            raise ValueError("The decorated function must have a docstring specifying the LLM instruction.")

        sig = inspect.signature(func)
        input_params = list(sig.parameters.keys())
        return_type = sig.return_annotation
        return_type_adapter = pydantic.TypeAdapter(return_type)

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if len(args) > len(input_params):
                raise ValueError("Too many positional arguments.")

            input_data = {**dict(zip(input_params, args)), **kwargs}
            if any(param not in input_data for param in input_params):
                missing_params = [param for param in input_params if param not in input_data]
                raise ValueError(f"Missing arguments: {', '.join(missing_params)}")

            instruction = func.__doc__.strip()
            json_schema = return_type_adapter.json_schema()
            messages = [
                {
                    "role": "system",
                    "content": f"TASK: {instruction}\n\nRespond to the input data according to the task. Your response must be concise and adhere strictly to the task description. " + ("Your response should only contain the requested text, NEVER write 'Here it is:' or similar framing phrases. Do not acknowledge or communicate with the user outside of fulfilling the request." if return_type is str else f"Your response will consist of a raw JSON {json_schema['type']}, accompanied by no further text, NOT wrapped in a code block, with string values properly escaped, adhering to the structure defined by the following JSON Schema: {json.dumps(json_schema)}"),
                },
                {
                    "role": "user",
                    "content": (
                        "This is the input data:\n\n"
                        + "\n\n".join(
                            f"# {key}\n{_escape_code_block(str(value))}"
                            for key, value in input_data.items()
                        )
                        if input_data
                        else "This task has no input data."
                    ),
                },
            ]

            if len(json.dumps(messages)) > 250000:
                raise ValueError(
                    "Input too long! Try spliting input into chunks of 200000 characters and processing them separately, then merging the results. You can use _ to define another function for merging partial results."
                )

            response = await request(
                "chat_completion",
                {
                    "messages": messages,
                    "temperature": 0.8 if creative else 0.0,
                    "max_tokens": 4096,
                    "json_schema": None if return_type is str else json_schema,
                }
            )

            if error := getattr(response, 'error', None):
                raise UnfixableException(error)

            if return_type is str:
                return response.message
            return return_type_adapter.validate_json(response.message)

        return wrapper
    return _llm_function


def format_traceback_with_locals(exc, skip_frames=0):
    traceback_segments = traceback.format_exception(exc)
    traceback_string = traceback_segments[0].rstrip() + "\n"
    tb = exc.__traceback__
    while tb is not None:
        if skip_frames > 0:
            skip_frames -= 1
            tb = tb.tb_next
            continue
        traceback_segment = traceback.format_tb(tb)[0]
        traceback_string += traceback_segment
        if traceback_segment.startswith("  File \"/home/pyodide/app.py\","):
            traceback_string += "  Local variables:\n"
            for k, v in tb.tb_frame.f_locals.items():
                if k.startswith("__"):
                    continue
                str_v = repr(v)
                if len(str_v) > 1000:
                    str_v = str_v[:1000] + f"<... and {len(str_v) - 1000} more characters>"
                traceback_string += f"{k} = {str_v}\n"
        tb = tb.tb_next
    traceback_string += traceback_segments[-1]
    return traceback_string


@st.fragment
def error_fragment(error_text):
    with st.container(border=True):
        if st.session_state.get("_bee_fixing_error"):
            st.write("🛠️ The error is being fixed...")
        else:
            st.write("🤯 An error occurred while executing the app.")
            if CONFIG.get("can_fix_error"):
                if st.button("Try to fix this error", icon="🛠️", type="primary"):
                    request("fix_error", { "errorText": error_text })
                    st.session_state._bee_fixing_error = True
                    st.rerun(scope="fragment")
            st.expander("Error details").code(error_text, language=None)


@st.fragment
def unfixable_error_fragment(error: UnfixableException):
    st.error(str(error) or 'Unknown error occurred.')

def identify_modules(code: str) -> set[str]:
    imported_packages = set()
    for node in ast.walk(ast.parse(code)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_packages.add(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_packages.add(node.module.split('.')[0])
    return imported_packages


async def translate_modules_to_packages(modules):
    OVERRIDES = {
        "docx": "python-docx",
        "PyPDF2": "PyPDF2<3"
    }
    packages = [OVERRIDES[module] for module in modules if module in OVERRIDES.keys()]
    if unknown_modules := [module for module in modules if module not in OVERRIDES.keys()]:
        response = await request(
            "modules_to_packages",
            {"modules": unknown_modules},
        )
        if not getattr(response, 'error', None):
            packages += response.packages
    return packages


def patch_streamlit():
    # LLM function -- we just pretend it's a part of Streamlit to avoid import shenanigans
    st.llm_function = llm_function

    # Form submit button does not accept a key -- make it accept & ignore it
    st_form_submit_button = st.form_submit_button
    st.form_submit_button = lambda *args, **kwargs: st_form_submit_button(*args, **{ k: v for k, v in kwargs.items() if k != "key"})

    # Form -- have no border by default
    st_form = st.form
    st.form = lambda *args, **kwargs: st_form(*args, **{**kwargs, "border": False})

    # Metric -- accept and ignore `min_value` and `max_value`
    st_metric = st.metric
    st.metric = lambda *args, **kwargs: st_metric(*args, **{ k: v for k, v in kwargs.items() if k not in ["min_value", "max_value"]})

    # Title -- replace by custom element, allow subtitle
    st.title = lambda heading, description, **kwargs: st.markdown(f'<div class="bee-st-title"><div class="bee-st-title-heading">{heading}</div><div class="bee-st-title-description">{description}</div></div>', unsafe_allow_html=True)

    def fix_markdown(body):
        body = re.sub(r"^•", "*", body, flags=re.MULTILINE) # Replace Unicode bullet points
        body = re.sub(r"^(#+ .+\n)[=-]+$", r"\1", body, flags=re.MULTILINE) # Replace combined (# and underline) headings
        return body

    # Markdown -- fix wrongly generated formatting
    st_markdown = st.markdown
    st.markdown = lambda body, *args, **kwargs: st_markdown(fix_markdown(body), *args, **kwargs)

    # Write -- fix wrongly generated formatting, but only for strings
    st_write = st.write
    st.write = lambda *args, **kwargs: st_write(*(fix_markdown(arg) if type(arg) is str else arg for arg in args), **kwargs)


async def run():
    try:
        code = pathlib.Path("app.py").read_text()
        if st.session_state.get("_bee_last_code") != code:
            imported_modules = identify_modules(code)
            available_modules = sys.modules.keys()
            needed_modules = list(imported_modules - available_modules)
            if needed_modules:
                packages = await translate_modules_to_packages(needed_modules)
                await asyncio.gather(
                    *(micropip.install(package) for package in packages),
                    return_exceptions=True,
                )
            st.session_state._bee_last_code = code
            st.session_state._bee_fixing_error = False

        await asyncio.sleep(0.01)
        patch_streamlit()
        await importlib.import_module("app").main()
    except UnfixableException as error:
        unfixable_error_fragment(error)
    except Exception as e:
        error_fragment(format_traceback_with_locals(e, skip_frames=1))


__all__ = ["run"]
