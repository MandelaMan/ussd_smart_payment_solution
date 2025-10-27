// controllers/ussd.controller.js
const moment = require("moment");
const { initiateSTKPush } = require("./mpesa.controller");
const {
  readTransactions,
  findLatestTxnByCheckoutOrPhone,
} = require("../../utils/transactions");

const packageList = [
  { name: "Basic ", bandwidth: "30MBPS", price: 1 },
  { name: "Basic + DSTV", bandwidth: "30MBPS", price: 2 },
  { name: "Basic Plus", bandwidth: "50MBPS", price: 3 },
  { name: "Basic Plus + DSTV", bandwidth: "50MBPS", price: 4 },
  { name: "Premium", bandwidth: "100MBPS", price: 5 },
  { name: "Premium + DSTV", bandwidth: "100MBPS", price: 6 },
];

// Poll for callback landing (max ~timeoutMs)
const waitForTxnStatus = async ({
  checkoutId,
  phone,
  timeoutMs = 25000,
  everyMs = 2500,
}) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const txn = await findLatestTxnByCheckoutOrPhone(checkoutId, phone);
    if (txn && (txn.Status === "SUCCESS" || txn.Status === "FAILED"))
      return txn;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return null; // timed out
};

// Safaricom sends TransactionDate in YYYYMMDDHHmmss (EAT)
const parseMpesaTransactionDate = (yyyymmddhhmmss) => {
  if (!yyyymmddhhmmss) return new Date();
  return moment(String(yyyymmddhhmmss), "YYYYMMDDHHmmss").toDate();
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const formatDmy = (date) => moment(date).format("DD/MM/YYYY");

// Simulated account details lookup (replace with real DB)
const getAccountDetails = async (accountNumber) => {
  return {
    customer_name: "TEST1 TEST1 TEST1",
    customer_number: "ET-001",
    aptNo: "B19",
    amount: 1, // current monthly package price
    package: "Basic Plus",
    status: "Active", // or "Inactive"
    dueDate: "31/10/2025",
  };
};

// --- USSD ---
const initiateUSSD = async (req, res) => {
  const { phoneNumber, text = "" } = req.body;

  let response;
  const input = text.trim();
  const parts = input.split("*");

  const mainMenu = `CON Welcome to Starlynx Utility Limited. Select from the options below:
  1. New Customer Registration
  2. Manage My Account
  0. Exit`;

  // entry / back
  if (input === "" || input === "99") {
    response = mainMenu;
  } else if (input === "0") {
    response = "END Thank you for using our service!";
  } else if (parts[0] === "1") {
    response = `END Please call 0713 400 200 or visit https://sulsolutions.biz/`;
  } else if (parts[0] === "2") {
    // Manage My Account
    if (parts.length === 1) {
      response = `CON Enter your Customer Number:
0. Exit
99. Back`;
    } else if (parts.length === 2) {
      // show account summary + actions
      const accountNumber = parts[1].trim();
      if (accountNumber === "0")
        return end(res, "Thank you for using our service!");
      if (accountNumber === "99") return send(res, mainMenu);

      const details = await getAccountDetails(accountNumber);
      if (!details) return end(res, `Account ${accountNumber} not found.`);

      response = `CON ${details.customer_name} Apt No. ${details.aptNo}
                Package: ${details.package} - Ksh ${details.amount}
                Account Status: ${details.status}
                Expires On: ${details.dueDate}
                1. Renew Subscription
                2. Upgrade Subscription
                3. Downgrade Subscription
                4. Cancel Subscription
                0. Exit
                99. Back`;
    } else if (parts.length === 3) {
      // choose action
      const accountNumber = parts[1].trim();
      const action = parts[2].trim();
      const details = await getAccountDetails(accountNumber);
      if (!details) return end(res, `Account ${accountNumber} not found.`);

      if (action === "1") {
        // === RENEW ===
        const amount = details.amount;
        const stk = await initiateSTKPush(accountNumber, phoneNumber, amount);
        if (stk?.error) {
          return end(
            res,
            "Failed to initiate payment. Please try again later."
          );
        }

        // Your chosen UX: END now with instruction, then (optionally) short wait on server.
        const waitingMsg = `END Payment request sent. Please await M-Pesa screen to confirm transaction, Thank You.`;
        res.set("Content-Type", "text/plain");
        res.send(waitingMsg);

        // Optional short blocking poll (non-interactive; if it resolves, you'll END again)
        const txn = await waitForTxnStatus({
          checkoutId: stk.CheckoutRequestID,
          phone: phoneNumber,
          timeoutMs: 25000,
          everyMs: 2500,
        });

        if (!txn) return;

        if (txn.Status === "SUCCESS") {
          const paidAt = parseMpesaTransactionDate(txn.TransactionDate);
          const newExpiry = formatDmy(addDays(paidAt, 30));
          return end(
            res,
            `Payment was successful. Subscription has been renewed. New expiry date is ${newExpiry}.`
          );
        } else {
          const reason = txn.ResultDesc || "Transaction failed";
          return end(res, `Error processing payment: ${reason}`);
        }
      } else if (action === "2") {
        // === UPGRADE: show package list ===
        const list = packageList
          .map(
            (p, i) => `${i + 1}. ${p.name} (${p.bandwidth}) - Ksh ${p.price}`
          )
          .join("\n");
        response = `CON Select a package to upgrade to:
${list}
0. Exit
99. Back`;
      } else if (action === "3") {
        // === DOWNGRADE: show package list ===
        const list = packageList
          .map(
            (p, i) => `${i + 1}. ${p.name} (${p.bandwidth}) - Ksh ${p.price}`
          )
          .join("\n");
        response = `CON Select a package to downgrade to:
${list}
0. Exit
99. Back`;
      } else if (action === "4") {
        response = `END Your subscription for account ${accountNumber} has been cancelled.`;
      } else if (action === "0") {
        response = "END Thank you for using our service!";
      } else if (action === "99") {
        response = mainMenu;
      } else {
        response = "END Invalid option selected.";
      }
    } else if (parts.length === 4) {
      // Handle package choice for upgrade/downgrade
      const accountNumber = parts[1].trim();
      const action = parts[2].trim(); // "2" upgrade, "3" downgrade
      const pick = parts[3].trim();

      if (pick === "0") return end(res, "Thank you for using our service!");
      if (pick === "99") return send(res, mainMenu);

      const idx = Number(pick) - 1;
      const target = packageList[idx];
      const details = await getAccountDetails(accountNumber);

      if (!target) return end(res, "Invalid package selection.");

      const currentPrice = Number(details.amount);
      const targetPrice = Number(target.price);
      const isActive = String(details.status || "").toLowerCase() === "active";

      if (action === "2") {
        // UPGRADE rules:
        const amount = isActive
          ? Math.max(0, targetPrice - currentPrice)
          : targetPrice;

        if (amount <= 0 && isActive) {
          return end(
            res,
            `No additional payment required. Package updated to ${target.name}.`
          );
        }

        const stk = await initiateSTKPush(accountNumber, phoneNumber, amount);
        if (stk?.error)
          return end(
            res,
            "Failed to initiate payment. Please try again later."
          );

        const waitingMsg = `CON Waiting for payment...
(Do not exit. You'll be updated shortly.)`;
        res.set("Content-Type", "text/plain");
        res.send(waitingMsg);

        const txn = await waitForTxnStatus({
          checkoutId: stk.CheckoutRequestID,
          phone: phoneNumber,
          timeoutMs: 25000,
          everyMs: 2500,
        });

        if (!txn) return;

        if (txn.Status === "SUCCESS") {
          return end(
            res,
            `Payment successful. Package has been upgraded to ${target.name}.`
          );
        } else {
          const reason = txn.ResultDesc || "Transaction failed";
          return end(res, `Error processing payment: ${reason}`);
        }
      } else if (action === "3") {
        // DOWNGRADE rules:
        if (isActive && targetPrice < currentPrice) {
          return end(
            res,
            `Package has been downgraded to ${target.name} successfully.`
          );
        }

        const amount = isActive ? 0 : targetPrice;
        if (amount <= 0) {
          return end(
            res,
            `Package has been downgraded to ${target.name} successfully.`
          );
        }

        const stk = await initiateSTKPush(accountNumber, phoneNumber, amount);
        if (stk?.error)
          return end(
            res,
            "Failed to initiate payment. Please try again later."
          );

        const waitingMsg = `CON Waiting for payment...
                            (Do not exit. You'll be updated shortly.)`;
        res.set("Content-Type", "text/plain");
        res.send(waitingMsg);

        const txn = await waitForTxnStatus({
          checkoutId: stk.CheckoutRequestID,
          phone: phoneNumber,
          timeoutMs: 25000,
          everyMs: 2500,
        });

        if (!txn) return;

        if (txn.Status === "SUCCESS") {
          return end(
            res,
            `Payment successful. Package has been downgraded to ${target.name}.`
          );
        } else {
          const reason = txn.ResultDesc || "Transaction failed";
          return end(res, `Error processing payment: ${reason}`);
        }
      } else {
        return end(res, "END Invalid option selected.");
      }
    } else {
      response = "END Invalid entry. Please try again.";
    }
  } else {
    response = "END Invalid choice. Please try again.";
  }

  send(res, response);
};

// convenience for consistent headers
const send = (res, text) => {
  res.set("Content-Type", "text/plain");
  res.send(text);
};
const end = (res, text) => send(res, `END ${text}`);

const test = async (req, res) => res.json({ message: "OK" });

module.exports = { initiateUSSD, test };
