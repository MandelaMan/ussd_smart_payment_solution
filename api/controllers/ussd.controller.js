const initiateUSSD = async (req, res) => {
  const { phoneNumber, text = "" } = req.body;

  let packageAmount = 1;

  const input = text.trim();
  const parts = input.split("*");

  let response;

  const mainMenu = `CON Welcome to Starlynx Utility Limited. Select from the options below:
  1. New Customer Registration
  2. Manage My Account
  0. Exit`;

  res.set("Content-Type", "text/plain");
  res.send(response);
};

const test = async (req, res) => {
  res.json({
    message: "OK",
  });
};

module.exports = {
  initiateUSSD,
  test,
};
