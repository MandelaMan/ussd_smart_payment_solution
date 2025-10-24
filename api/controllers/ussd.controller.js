// controllers/ussd.controller.js
const { initiateSTKPush } = require("./mpesa.controller");
const {
  readTransactions,
  mostRecentForPhone,
} = require("../../utils/transactions");

const initiateUSSD = async (req, res) => {
  const { phoneNumber, text = "" } = req.body;

  let packageAmount = 1;
  const input = String(text || "").trim();
  const parts = input.split("*").filter(Boolean);

  let response;

  //   // Check for a recent transaction to “alert”
  //   let banner = "";
  //   try {
  //     const all = await readTransactions();
  //     const recent = mostRecentForPhone(all, phoneNumber);
  //     if (recent) {
  //       const minutesAgo =
  //         (Date.now() - new Date(recent.Timestamp).getTime()) / 60000;
  //       if (minutesAgo <= 10 && recent.Status) {
  //         if (recent.Status === "SUCCESS") {
  //           banner = `\n\n✅ Payment received (Ksh ${
  //             recent.Amount || "-"
  //           }). Ref: ${recent.MpesaReceiptNumber || "-"}\n`;
  //         } else if (recent.Status === "FAILED") {
  //           banner = `\n\n❌ Last payment failed: ${recent.ResultDesc}\n`;
  //         } else if (recent.Status === "PENDING") {
  //           banner = `\n\n⏳ Awaiting your M-Pesa PIN to complete the payment…\n`;
  //         }
  //       }
  //     }
  //   } catch (e) {
  //     // ignore banner errors
  //   }

  const mainMenu = `CON Welcome to Starlynx Utility Limited. Select from the options below:
  1. New Customer Registration
  2. Manage My Account
  0. Exit`;

  if (input === "" || input === "99") {
    response = mainMenu;
  } else if (input === "0") {
    response = "END Thank you for using our service!";
  } else if (parts[0] === "1") {
    response = `END Please call 0713 400 200 or visit https://sulsolutions.biz/`;
  } else if (parts[0] === "2") {
    if (parts.length === 1) {
      response = `CON Enter your Customer Number:
                  0. Exit
                  99. Back`;
    } else if (parts.length === 2) {
      const accountNumber = parts[1].trim();

      if (accountNumber === "0") {
        response = "END Thank you for using our service!";
      } else if (accountNumber === "99") {
        response = mainMenu;
      } else {
        const details = {
          customer_name: "ET-E201",
          amount: 5900,
          package: "Basic Plus",
          status: "Active",
          dueDate: "31/10/2025",
        };

        response = `CON ${details.customer_name}\nPackage: ${details.package} - Ksh ${details.amount}\nAccount Status: ${details.status}\nExpires On: ${details.dueDate}\n 
              1. Renew Subscription
              2. Upgrade Subscription
              3. Downgrade Subscription
              4. Cancel Subscription
              0. Exit
              99.Back`;
      }
    } else if (parts.length === 3) {
      const accountNumber = parts[1].trim();
      const action = parts[2].trim();

      if (action === "1") {
        const results = await initiateSTKPush(phoneNumber, packageAmount);

        if (!results?.error) {
          response =
            "END Request submitted to M-PESA for processing. Enter your M-PESA PIN when prompted.";
        } else {
          response = "END Failed to initiate payment. Please try again later.";
        }
      } else if (action === "2") {
        response = `END Your subscription for account ${accountNumber} has been upgraded. Our team will contact you shortly.`;
      } else if (action === "3") {
        response = `END Your subscription for account ${accountNumber} has been cancelled.`;
      } else if (action === "0") {
        response = "END Thank you for using our service!";
      } else if (action === "99") {
        response = `CON Enter your Customer Number:
                      0. Exit
                      99. Back`;
      } else {
        response = "END Invalid option selected.";
      }
    } else {
      response = "END Invalid entry. Please try again.";
    }
  } else {
    response = "END Invalid choice. Please try again.";
  }

  res.set("Content-Type", "text/plain");
  res.send(response);
};

const test = async (req, res) => {
  res.json({ message: "OK" });
};

module.exports = { initiateUSSD, test };
