const express = require("express");
const { protect } = require("../../middleware/auth");
const {
  sendMessage,
  getMessages,
  getConversations,
} = require("../../controllers/chat/ChatController");

const router = express.Router();

// Send a new message
router.post("/send", protect, sendMessage);

// Get all messages for a specific conversation
router.get("/messages/:conversationId", protect, getMessages);

// Get all conversations for current user
router.get("/conversations", protect, getConversations);

module.exports = router;
