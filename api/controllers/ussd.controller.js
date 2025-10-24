// api/controllers/ussd.controller.js

const { initiateSTKPush } = require("./mpesa.controller");
const {
  readTransactions,
  writeTransactions,
  mostRecentForPhone,
} = require("../../utils/transactions");

const initiateUSSD = async (req, res) => {
  const { phoneNumber, text = "" } = req.body;
  const input = text.trim();
  const parts = input.split("*");
  const packageAmount = 1;
  let response;

  // 🧠 Try showing banner from last transaction
  let banner = "";
  try {
    const all = await readTransactions();
    const recent = mostRecentForPhone(all, phoneNumber);
    if (recent) {
      const minutesAgo =
        (Date.now() - new Date(recent.Timestamp).getTime()) / 60000;
      if (minutesAgo < 30) {
        if (recent.Status === "SUCCESS") {
          banner = `\n✅ Payment of Ksh ${
            recent.Amount || "-"
          } received (Ref: ${recent.MpesaReceiptNumber || "-"})`;
        } else if (recent.Status === "FAILED") {
          banner = `\n❌ Last payment failed (${recent.ResultDesc || "Error"})`;
        } else if (recent.Status === "PENDING") {
          banner = `\n⏳ Awaiting M-PESA confirmation...`;
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Could not read transactions:", err.message);
  }

  const mainMenu = `CON${banner}\nWelcome to Starlynx Utility Limited. Select from the options below:
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
      if (accountNumber === "0")
        response = "END Thank you for using our service!";
      else if (accountNumber === "99") response = mainMenu;
      else {
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
99. Back`;
      }
    } else if (parts.length === 3) {
      const accountNumber = parts[1].trim();
      const action = parts[2].trim();

      if (action === "1") {
        try {
          const result = await initiateSTKPush(phoneNumber, packageAmount);

          if (result?.MerchantRequestID) {
            // Log pending transaction
            const all = await readTransactions();
            all.push({
              Status: "PENDING",
              PhoneNumber: phoneNumber.replace(/^(\+|0)+/, ""),
              Amount: packageAmount,
              MerchantRequestID: result.MerchantRequestID,
              CheckoutRequestID: result.CheckoutRequestID,
              ResultDesc: "Awaiting customer PIN",
              Timestamp: new Date().toISOString(),
            });
            await writeTransactions(all);

            response =
              "END Request submitted to M-PESA. Enter your PIN when prompted.";
          } else {
            response =
              "END Failed to initiate payment. Please try again later.";
          }
        } catch (err) {
          console.error("❌ STK Push Error:", err.message);
          response = "END Payment initiation failed. Please try again later.";
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

const test = async (req, res) => res.json({ message: "OK" });

module.exports = { initiateUSSD, test };
