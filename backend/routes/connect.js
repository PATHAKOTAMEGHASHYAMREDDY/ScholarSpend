const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Group = require('../models/Group');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

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

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const calculateBalances = (group) => {
  const balances = {};
  const paidBy = {};
  const owed = {};

  group.expenses.forEach((exp) => {
    paidBy[exp.paidBy._id] = (paidBy[exp.paidBy._id] || 0) + exp.amount;
    exp.splits.forEach((split) => {
      owed[split.user._id] = (owed[split.user._id] || 0) + split.amount;
    });
  });

  group.members.forEach((member) => {
    const paid = paidBy[member._id] || 0;
    const owes = owed[member._id] || 0;
    balances[member._id] = paid - owes;
  });

  const result = {};
  const debtors = Object.entries(balances).filter(([, balance]) => balance > 0);
  const creditors = Object.entries(balances).filter(([, balance]) => balance < 0);

  debtors.forEach(([debtorId, debt]) => {
    let remainingDebt = debt;
    creditors.forEach(([creditorId, credit]) => {
      if (remainingDebt > 0 && credit < 0) {
        const amount = Math.min(remainingDebt, -credit);
        if (amount > 0) {
          const debtorName = group.members.find((m) => m._id.toString() === debtorId).username;
          const creditorName = group.members.find((m) => m._id.toString() === creditorId).username;
          result[`${debtorName} owes ${creditorName}`] = amount;
          remainingDebt -= amount;
          balances[creditorId] += amount;
        }
      }
    });
  });

  return result;
};

router.get('/groups', authenticateToken, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id })
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username _id')
      .populate('expenses.splits.user', 'username _id')
      .populate('owner', 'username _id');
    res.json({ groups });
  } catch (error) {
    console.error('Error fetching groups:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/search-users', authenticateToken, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ message: 'Search query is required' });

  try {
    const users = await User.find({
      $or: [
        { email: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
      ],
      _id: { $ne: req.user.id },
    }).select('username email');
    res.json({ users });
  } catch (error) {
    console.error('Error searching users:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/groups', authenticateToken, async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !memberIds || memberIds.length === 0) {
    return res.status(400).json({ message: 'Group name and members are required' });
  }

  try {
    const members = [...new Set([req.user.id, ...memberIds])];
    const group = new Group({ name, members, owner: req.user.id });
    await group.save();

    const populatedGroup = await Group.findById(group._id)
      .populate('members', 'username email')
      .populate('owner', 'username _id');

    const emailContent = `
      <h2>You've Been Added to a Group!</h2>
      <p>You are now a member of the group <strong>${name}</strong>, created by ${populatedGroup.owner.username}.</p>
      <p>Members: ${populatedGroup.members.map(m => m.username).join(', ')}</p>
      <p>Start adding your expenses now!</p>
    `;

    const emailPromises = populatedGroup.members.map((member) =>
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: member.email,
        subject: `You've Been Added to ${name}`,
        html: emailContent,
      })
    );

    await Promise.all(emailPromises);

    res.status(201).json({ group: populatedGroup });
  } catch (error) {
    console.error('Error creating group:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/groups/:groupId/expenses', authenticateToken, async (req, res) => {
  const { groupId } = req.params;
  const { description, amount, splits } = req.body;

  if (!description || !amount || !splits || Object.keys(splits).length === 0) {
    return res.status(400).json({ message: 'Description, amount, and splits are required' });
  }

  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (!group.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    if (group.isFinalized || group.isClosed) {
      return res.status(400).json({ message: 'Cannot add expenses to a finalized or closed group' });
    }

    const splitArray = Object.entries(splits).map(([userId, splitAmount]) => ({
      user: userId,
      amount: parseFloat(splitAmount),
    }));
    const totalSplit = splitArray.reduce((sum, split) => sum + split.amount, 0);
    const parsedAmount = parseFloat(amount);

    if (totalSplit !== parsedAmount) {
      return res.status(400).json({
        message: `Split total (₹${totalSplit.toFixed(2)}) must equal expense amount (₹${parsedAmount.toFixed(2)})`,
      });
    }

    const expense = {
      description,
      amount: parsedAmount,
      paidBy: req.user.id,
      splits: splitArray,
    };

    group.expenses.push(expense);
    await group.save();

    const populatedGroup = await Group.findById(groupId)
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username _id')
      .populate('expenses.splits.user', 'username _id')
      .populate('owner', 'username _id');

    res.json({ group: populatedGroup });
  } catch (error) {
    console.error('Error adding expense:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/groups/:groupId/finalize', authenticateToken, async (req, res) => {
  const { groupId } = req.params;

  try {
    const group = await Group.findById(groupId)
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username _id')
      .populate('expenses.splits.user', 'username _id')
      .populate('owner', 'username _id');

    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (group.owner._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the group owner can finalize the group' });
    }
    if (group.isFinalized) {
      return res.status(400).json({ message: 'Group is already finalized' });
    }

    group.isFinalized = true;
    await group.save();

    const balances = calculateBalances(group);

    const populatedGroup = await Group.findById(groupId)
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username _id')
      .populate('expenses.splits.user', 'username _id')
      .populate('owner', 'username _id');

    res.json({ group: populatedGroup, balances });
  } catch (error) {
    console.error('Error finalizing group:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/groups/:groupId/split-done', authenticateToken, async (req, res) => {
  const { groupId } = req.params;
  const { chartData } = req.body;

  try {
    const group = await Group.findById(groupId)
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username _id')
      .populate('expenses.splits.user', 'username _id')
      .populate('owner', 'username _id');

    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (group.owner._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the group owner can close the group' });
    }
    if (!group.isFinalized) {
      return res.status(400).json({ message: 'Group must be finalized before closing' });
    }
    if (group.isClosed) {
      return res.status(400).json({ message: 'Group is already closed' });
    }

    group.isClosed = true;
    await group.save();

    const totalExpenses = group.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const memberSummary = {};
    group.expenses.forEach((exp) => {
      exp.splits.forEach((split) => {
        memberSummary[split.user.username] = (memberSummary[split.user.username] || 0) + split.amount;
      });
    });

    const balances = calculateBalances(group);

    const chartHtml = `
      <h3>Expense Breakdown</h3>
      <table border="1" style="border-collapse: collapse; width: 100%;">
        <tr><th>Member</th><th>Amount (₹)</th></tr>
        ${chartData.map(item => `<tr><td>${item.name}</td><td>${item.value.toFixed(2)}</td></tr>`).join('')}
      </table>
    `;

    const emailContent = `
      <h2>${group.name} Expense Summary</h2>
      <p>Total Expenses: ₹${totalExpenses.toFixed(2)}</p>
      <h3>Breakdown by Member:</h3>
      <ul>
        ${Object.entries(memberSummary)
          .map(([username, amount]) => `<li>${username}: ₹${amount.toFixed(2)}</li>`)
          .join('')}
      </ul>
      <h3>Balances:</h3>
      <ul>
        ${Object.entries(balances)
          .map(([fromTo, amount]) => `<li>${fromTo}: ₹${amount.toFixed(2)}</li>`)
          .join('')}
      </ul>
      ${chartHtml}
      <p>Group closed by ${group.owner.username} on ${new Date().toLocaleDateString()}.</p>
    `;

    const emailPromises = group.members.map((member) =>
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: member.email,
        subject: `${group.name} Expenses Closed`,
        html: emailContent,
      })
    );

    await Promise.all(emailPromises);

    const updatedGroup = await Group.findById(groupId)
      .populate('members', 'username email')
      .populate('expenses.paidBy', 'username _id')
      .populate('expenses.splits.user', 'username _id')
      .populate('owner', 'username _id');

    res.json({ group: updatedGroup, balances });
  } catch (error) {
    console.error('Error closing group:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;