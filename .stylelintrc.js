module.exports = {
  extends: ['stylelint-config-recommended-scss'],
  plugins: ['stylelint-plugin-logical-css'],
  rules: {
    'scss/function-no-unknown': null,
    'scss/operator-no-newline-after': null,
    'no-descending-specificity': null,
    'plugin/use-logical-properties-and-values': [
      true,
      {
        severity: 'warning',
        ignore: ['overflow-y', 'overflow-x', '-webkit-box-orient'],
      },
    ],
  },
};
