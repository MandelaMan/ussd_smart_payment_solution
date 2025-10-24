// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "ussd_smart_payment_solution",
      script: "index.js", // <-- change to your actual entry file
      cwd: process.env.DEPLOY_PATH || ".",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
