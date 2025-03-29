const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Group = require('../models/Group');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  debug: false,
  logger: false,
});
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter verification failed:', error.stack);
  } else {
    console.log('Email transporter is ready to send messages');
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access denied' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ message: 'Invalid token' });
  }
};

// Search users to add to groups
router.post('/search-users', authenticateToken, async (req, res) => {
  const { query } = req.body;
  try {
    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ],
      _id: { $ne: req.user.id },
    }).select('username email _id');
    res.json({ users });
  } catch (error) {
    console.error('Search users error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create a group
router.post('/groups', authenticateToken, async (req, res) => {
  const { name, memberIds } = req.body;
  try {
    const group = new Group({
      name,
      creator: req.user.id,
      members: [req.user.id, ...memberIds],
    });
    await group.save();

    await User.updateMany(
      { _id: { $in: [req.user.id, ...memberIds] } },
      { $push: { groups: group._id } }
    );

    const populatedGroup = await Group.findById(group._id)
      .populate('creator', 'username email')
      .populate('members', 'username email');

    res.json({ message: 'Group created successfully', group: populatedGroup });
  } catch (error) {
    console.error('Group creation error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all groups for the user
router.get('/groups', authenticateToken, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id })
      .populate('creator', 'username email')
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username email')
      .populate('expenses.splits.user', 'username email');
    res.json({ groups });
  } catch (error) {
    console.error('Fetch groups error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add expense to a group and split it
router.post('/groups/:groupId/expenses', authenticateToken, async (req, res) => {
  const { groupId } = req.params;
  const { description, amount, splits } = req.body;
  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (!group.members.some((m) => m.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Not a group member' });
    }

    const totalSplit = Object.values(splits).reduce((sum, val) => sum + parseFloat(val), 0);
    if (totalSplit !== parseFloat(amount)) {
      return res.status(400).json({ message: 'Split amounts must equal total amount' });
    }

    const expense = {
      description,
      amount: parseFloat(amount),
      paidBy: req.user.id,
      splits: Object.entries(splits).map(([userId, splitAmount]) => ({
        user: userId,
        amount: parseFloat(splitAmount),
      })),
    };

    group.expenses.push(expense);
    await group.save();

    const creator = await User.findById(req.user.id);
    const memberEmails = await User.find({ _id: { $in: group.members } }).select('email username');
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: memberEmails.map((m) => m.email),
      subject: `ScholarSpend - New Expense in ${group.name}`,
      html: `
        <h2>New Expense Added</h2>
        <p>${creator.username} added an expense to ${group.name}:</p>
        <p><strong>${description}</strong>: ₹${amount}</p>
        <p>Split Details:</p>
        <ul>
          ${Object.entries(splits).map(([userId, amt]) => {
            const user = memberEmails.find((m) => m._id.toString() === userId);
            return `<li>${user?.username || userId}: ₹${amt}</li>`;
          }).join('')}
        </ul>
        <p>Happy budgeting!<br><strong>The ScholarSpend Team</strong></p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Expense email sent:', info.messageId);

    const updatedGroup = await Group.findById(groupId)
      .populate('creator', 'username email')
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username email')
      .populate('expenses.splits.user', 'username email');

    res.json({ message: 'Expense added and split successfully', group: updatedGroup });
  } catch (error) {
    console.error('Add expense error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get specific group details
router.get('/groups/:groupId', authenticateToken, async (req, res) => {
  const { groupId } = req.params;
  try {
    const group = await Group.findById(groupId)
      .populate('creator', 'username email')
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username email')
      .populate('expenses.splits.user', 'username email');
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (!group.members.some((m) => m.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Not a group member' });
    }
    res.json({ group });
  } catch (error) {
    console.error('Fetch group error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;