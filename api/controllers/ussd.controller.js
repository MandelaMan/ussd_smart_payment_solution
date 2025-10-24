// controllers/ussd.controller.js
const { initiateSTKPush } = require("./mpesa.controller");
const { readTransactions } = require("../../utils/transactions");

// In-memory helper to remember last CheckoutRequestID per phone during process lifetime
// (Callback update will still be found from transactions.json if the process restarts.)
const pendingByPhone = new Map();

const normalizePhone = (phone = "") => phone.replace(/^(\+|0)+/, "");

const findLatestTxnForPhone = async ({ phone, checkoutId }) => {
  const all = await readTransactions();
  // Prefer exact match by CheckoutRequestID if we have it
  if (checkoutId) {
    const hit = [...all]
      .reverse()
      .find((t) => t.CheckoutRequestID === checkoutId);
    if (hit) return hit;
  }
  // Fallback: latest txn for this phone
  const user_phone = normalizePhone(phone);
  return [...all]
    .reverse()
    .find((t) => String(t.PhoneNumber || "").endsWith(user_phone));
};

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

  if (input === "" || input === "99") {
    response = mainMenu;
  } else if (input === "0") {
    response = "END Thank you for using our service!";
  } else if (parts[0] === "1") {
    // ${phoneNumber}
    response = `END Please call 0713 400 200 or visit https://sulsolutions.biz/`;
  } else if (parts[0] === "2") {
    if (parts.length === 1) {
      // Ask for account number
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

        if (!details) {
          response = `END Account ${accountNumber} not found.`;
        } else {
          // You can set packageAmount from details.amount if you want:
          // packageAmount = details.amount;

          response = `CON ${details.customer_name}
Package: ${details.package} - Ksh ${details.amount}
Account Status: ${details.status}
Expires On: ${details.dueDate}
1. Renew Subscription
2. Upgrade Subscription
3. Downgrade Subscription
4. Cancel Subscription
0. Exit
99. Back`;
        }
      }
    } else if (parts.length === 3) {
      const accountNumber = parts[1].trim();
      const action = parts[2].trim();

      if (action === "1") {
        // RENEW -> initiate STK and then offer a "check status" option
        const results = await initiateSTKPush(phoneNumber, packageAmount);

        if (results?.CheckoutRequestID) {
          pendingByPhone.set(phoneNumber, results.CheckoutRequestID);
        }

        if (results?.error) {
          response = "END Failed to initiate payment. Please try again later.";
        } else {
          response = `CON Request submitted to M-PESA for processing. Enter your M-PESA PIN when prompted.
1. Check Payment Status
0. Exit
99. Back`;
        }
      } else if (action === "2") {
        // Upgrade Subscription
        response = `END Your subscription for account ${accountNumber} has been upgraded. Our team will contact you shortly.`;
      } else if (action === "3") {
        // Downgrade Subscription
        response = `END Your subscription for account ${accountNumber} has been downgraded. Our team will contact you shortly.`;
      } else if (action === "4") {
        // Cancel Subscription
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
    } else if (parts.length === 4) {
      // layer after initiating STK: "check status"
      const action = parts[2].trim();
      const subAction = parts[3].trim();

      if (action === "1" && subAction === "1") {
        const checkoutId = pendingByPhone.get(phoneNumber);
        const txn = await findLatestTxnForPhone({
          phone: phoneNumber,
          checkoutId,
        });

        if (!txn) {
          response = `CON No payment update yet.
1. Check Payment Status
0. Exit
99. Back`;
        } else if (txn.Status === "SUCCESS") {
          // ✅ Success
          // TODO: here you can trigger your internal "renew subscription" logic if needed.
          response = "END Subscription has been renewed successfully.";
        } else if (txn.Status === "FAILED") {
          const reason = txn.ResultDesc || "Transaction failed";
          response = `END Error processing payment: ${reason}`;
        } else {
          // PENDING or unknown
          response = `CON Payment is still pending. Please complete on your phone.
1. Check Payment Status
0. Exit
99. Back`;
        }
      } else if (subAction === "0") {
        response = "END Thank you for using our service!";
      } else if (subAction === "99") {
        response = mainMenu;
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
