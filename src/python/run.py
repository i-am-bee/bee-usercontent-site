import asyncio
import json
import pathlib
import micropip
import traceback
import streamlit as st
import runpy
import ast
import sys
from pyodide.http import pyfetch
import re
import requests
import requests.adapters
import inspect
from functools import wraps
import pydantic
import warnings


warnings.filterwarnings("ignore")
CONFIG = json.loads(pathlib.Path(__file__).parent.resolve().joinpath("config.json").read_text())


def _escape_code_block(s):
    longest_backtick_group_length = max(
        (len(match) for match in re.findall(r"`+", s)), default=0
    )
    target_backtick_count = max(longest_backtick_group_length + 1, 3)
    backticks = "`" * target_backtick_count
    return f"{backticks}\n{s}\n{backticks}"


class LLMFunctionLimitExceededException(Exception):
    pass


def llm_function(creative=False):
    def _llm_function(func):
        if not func.__doc__:
            raise ValueError("The decorated function must have a docstring specifying the LLM instruction.")

        sig = inspect.signature(func)
        input_params = list(sig.parameters.keys())
        return_type = sig.return_annotation
        return_type_adapter = pydantic.TypeAdapter(return_type)

        @wraps(func)
        def wrapper(*args, **kwargs):
            if CONFIG.get("llm_function_rate_limited"):
                raise LLMFunctionLimitExceededException()

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
                    "content": f"TASK: {instruction}\n\nRespond to the input data according to the task. Your response must be concise and adhere strictly to the task description. " + ("Your response should only contain the requested text, NEVER write 'Here it is:' or similar framing phrases. Do not acknowledge or cummunicate with the user outside of fulfilling the request." if return_type is str else f"Your reponse will consist of a raw JSON {json_schema['type']}, accompanied by no further text, NOT wrapped in a code block, with string values properly escaped, adhering to the structure defined by the following JSON Schema: {json.dumps(json_schema)}"),
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

            with requests.Session() as s:
                s.mount(CONFIG["api_url"], requests.adapters.HTTPAdapter(max_retries=requests.adapters.Retry(
                    total=5,
                    status_forcelist=[429],
                    backoff_factor=1.0,
                )))

                response = requests.post(
                    f"{CONFIG["api_url"]}/v1/chat/completions",
                    headers={"Content-Type": "application/json"},
                    json={
                        "model": "runtime",
                        "messages": messages,
                        "temperature": 0.8 if creative else 0.0,
                        "max_tokens": 4096,
                        "json_schema": None if return_type is str else json_schema,
                    }
                )

                try:
                    response.raise_for_status()
                except requests.HTTPError as e:
                    if e.response.status_code == 429:
                        raise LLMFunctionLimitExceededException() from e
                    else:
                        raise

                response_text = response.json()["choices"][0]["message"]["content"]

                if return_type is str:
                    return response_text
                return return_type_adapter.validate_json(response_text)

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
        if traceback_segment.startswith("  File \"app.py\","):
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
    root = st.empty()
    with root.container(border=True):
        st.write("🤯 An error occurred while executing the app.")
        if st.button("Try to fix this error", icon="🛠️", type="primary"):
            with root.container(border=True):
                st.components.v1.html(
                    f"""
                    // This iframe is hidden using CSS. Do not remove this comment.
                    <script>
                    window.parent.postMessage({json.dumps({"type": "reportError", "errorText": error_text})}, "*")
                    </script>
                    """
                )
                st.write("🛠️ The error is being fixed...")
                return
        st.expander("Error details").code(error_text, language=None)


@st.fragment
def llm_function_rate_limit_exceeded_error_fragment():
    st.error("You have exceeded the limit for using LLM functions.")
    st.components.v1.html(
        f"""
        // This iframe is hidden using CSS. Do not remove this comment.
        <script>
        window.parent.postMessage({json.dumps({"type": "reportRateLimitExceededError"})}, "*")
        </script>
        """
    )


def identify_modules(source_code: str) -> set[str]:
    imported_packages = set()
    for node in ast.walk(ast.parse(source_code)):
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
        response = await pyfetch(
            url=f"{CONFIG["api_url"]}/modules-to-packages",  # TODO -- hardcoded URL, can't use relative here
            method="POST",
            headers={"Content-Type": "application/json"},
            body=json.dumps({"modules": unknown_modules}),
        )
        if response.ok:
            data = await response.json()
            packages += data.get("packages", [])
    return packages


def patch_streamlit():
    # LLM function -- we just pretend it's a part of Streamlit to avoid import shenanigans
    st.llm_function = llm_function

    # Form submit button does not accept a key -- make it accept & ignore it
    st_form_submit_button = st.form_submit_button
    st.form_submit_button = lambda *args, **kwargs: st_form_submit_button(*args, **{ k: v for k, v in kwargs.items() if k != "key"})

    # Form -- have no border by default
    st_form = st.form
    st.form = lambda *args, **kwargs: st_form(*args, **{**kwargs, "border": False})

    # Metric -- accept and ignore `min_value` and `max_value`
    st_metric = st.metric
    st.metric = lambda *args, **kwargs: st_metric(*args, **{ k: v for k, v in kwargs.items() if k not in ["min_value", "max_value"]})


async def run():
    source = pathlib.Path("app.py").read_text()
    imported_modules = identify_modules(source)
    available_modules = sys.modules.keys()
    needed_modules = list(imported_modules - available_modules)
    if needed_modules:
        packages = await translate_modules_to_packages(needed_modules)
        await asyncio.gather(
            *(micropip.install(package) for package in packages),
            return_exceptions=True,
        )
    try:
        # 10ms wait needed by Stlite -- it won't update UI, incl. loading indicator, during sync execution
        await asyncio.sleep(0.01)

        patch_streamlit()
        runpy.run_path("app.py", run_name="__main__")
    except LLMFunctionLimitExceededException:
        llm_function_rate_limit_exceeded_error_fragment()
    except Exception as e:
        error_fragment(format_traceback_with_locals(e, skip_frames=4))


__all__ = ["run"]