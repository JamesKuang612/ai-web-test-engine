module.exports = {
    extends: [
        "nstarter",
        "nstarter/typescript",
    ],
    rules: {

    },
    globals: {
        Constructor: "readable",
        Callback: "readable"
    },
    overrides: [
        {
            files: ["test/**/*.ts"],
            env: {
                mocha: true
            }
        }
    ]
};
