const db = require("../../config/db");

// 📩 Send a new message
exports.sendMessage = async (req, res) => {
  const { receiverId, message } = req.body;
  const senderId = req.user.id;

  try {
    // ✅ Find or create conversation
    const [existing] = await db.query(
      `SELECT id FROM conversations 
       WHERE (user1_id = ? AND user2_id = ?) 
       OR (user1_id = ? AND user2_id = ?) LIMIT 1`,
      [senderId, receiverId, receiverId, senderId]
    );

    let conversationId;
    if (existing.length > 0) {
      conversationId = existing[0].id;
    } else {
      const [conv] = await db.query(
        `INSERT INTO conversations (user1_id, user2_id, createdAt) VALUES (?, ?, NOW())`,
        [senderId, receiverId]
      );
      conversationId = conv.insertId;
    }

    // ✅ Insert new message
    await db.query(
      `INSERT INTO messages (conversation_id, sender_id, message, createdAt) VALUES (?, ?, ?, NOW())`,
      [conversationId, senderId, message]
    );

    res.json({ success: true, message: "Message sent successfully", conversationId });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 💬 Get all messages for one conversation
exports.getMessages = async (req, res) => {
  const { conversationId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY createdAt ASC`,
      [conversationId]
    );
    res.json({ success: true, messages: rows });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 📜 Get all conversations for logged-in user
exports.getConversations = async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await db.query(
      `SELECT 
          c.id AS conversationId,
          u.id AS userId,
          u.name,
          u.profilePic
       FROM conversations c
       JOIN users u
         ON u.id = IF(c.user1_id = ?, c.user2_id, c.user1_id)
       WHERE c.user1_id = ? OR c.user2_id = ?`,
      [userId, userId, userId]
    );

    res.json({ success: true, conversations: rows });
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

