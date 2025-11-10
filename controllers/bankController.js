const { v4: uuidv4 } = require("uuid");
const db = require("../config/db"); // adjust your DB path

// ✅ Add or update bank account
exports.addBankAccount = async (req, res) => {
  try {
    const userId = req.user.id; // from token
    const { accountHolderName, accountNumber, ifscCode, bankName, branchName } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName || !branchName) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Check if user already has a bank account
    const [existing] = await db.execute("SELECT id FROM bank_accounts WHERE userId = ?", [userId]);

    if (existing.length > 0) {
      // Update existing account
      await db.execute(
        `UPDATE bank_accounts
         SET accountHolderName = ?, accountNumber = ?, ifscCode = ?, bankName = ?, branchName = ?, updatedAt = NOW()
         WHERE userId = ?`,
        [accountHolderName, accountNumber, ifscCode, bankName, branchName, userId]
      );
      return res.json({ success: true, message: "Bank account updated successfully" });
    } else {
      // Add new account
      const id = uuidv4();
      await db.execute(
        `INSERT INTO bank_accounts (id, userId, accountHolderName, accountNumber, ifscCode, bankName, branchName, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, userId, accountHolderName, accountNumber, ifscCode, bankName, branchName]
      );
      return res.json({ success: true, message: "Bank account added successfully" });
    }
  } catch (error) {
    console.error("Error adding bank account:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};

// ✅ Get user's bank account (by token)
exports.getMyBankAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.execute(
      "SELECT accountHolderName, accountNumber, ifscCode, bankName, branchName, createdAt, updatedAt FROM bank_accounts WHERE userId = ?",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No bank account found" });
    }

    res.json({ success: true, bankAccount: rows[0] });
  } catch (error) {
    console.error("Error fetching bank account:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};


// ✅ Update existing bank account (PUT API)
exports.updateBankAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { accountHolderName, accountNumber, ifscCode, bankName, branchName } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName || !branchName) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Ensure user has an account
    const [existing] = await db.execute("SELECT id FROM bank_accounts WHERE userId = ?", [userId]);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "No bank account found to update" });
    }

    // Update bank details
    await db.execute(
      `UPDATE bank_accounts
       SET accountHolderName = ?, accountNumber = ?, ifscCode = ?, bankName = ?, branchName = ?, updatedAt = NOW()
       WHERE userId = ?`,
      [accountHolderName, accountNumber, ifscCode, bankName, branchName, userId]
    );

    res.json({ success: true, message: "Bank account updated successfully" });
  } catch (error) {
    console.error("Error updating bank account:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};

