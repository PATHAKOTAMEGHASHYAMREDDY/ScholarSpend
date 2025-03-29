const express = require('express');
const router = express.Router();
const User = require('../models/User');
const OTP = require('../models/OTP');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(process.env.JWT_SECRET, 'salt', 32);

const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
};

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

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const otp = generateOtp();
  const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    await OTP.findOneAndUpdate(
      { email },
      { otp, createdAt: new Date(), expiresAt: expiryTime },
      { upsert: true, new: true }
    );
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'ScholarSpend 😉: Confirm Your Email to Get Started',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Email Verification - ScholarSpend</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f8f9fa;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 20px auto;
              background-color: #ffffff;
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 20px;
              text-align: center;
              box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
            }
            h2 {
              color: #1e40af;
            }
            p {
              color: #333333;
              font-size: 16px;
              line-height: 1.5;
            }
            .otp-code {
              font-size: 24px;
              font-weight: bold;
              color: #2563eb;
              background-color: #e0f2fe;
              display: inline-block;
              padding: 10px 20px;
              border-radius: 5px;
              margin: 10px 0;
            }
            .footer {
              font-size: 12px;
              color: #6b7280;
              margin-top: 20px;
            }
            a {
              color: #2563eb;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Welcome to ScholarSpend</h2>
            <p>Hello,Scholar</p>
            <p>Thank you for Trusting us!. To complete your registration, please use the OTP code below:</p>
            <div class="otp-code">${otp}</div>
            <p>This code is valid for <strong>10 minutes</strong>. If you did not want this, please ignore this email.</p>
            <p>Happy budgeting!<br><strong>The ScholarSpend Team</strong></p>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('OTP email sent:', info.messageId);
    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Error sending OTP email:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/signup', async (req, res) => {
  const { username, email, password, role, otp } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord || new Date() > otpRecord.expiresAt) {
      await OTP.deleteOne({ email, otp });
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const encryptedSalary = encrypt('0');
    const user = new User({
      username,
      email,
      password: hashedPassword,
      role: role || 'user',
      verified: true,
      salary: encryptedSalary,
    });
    await user.save();
    await OTP.deleteOne({ email, otp });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Signup successful', token });
  } catch (error) {
    console.error('Signup error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token });
  } catch (error) {
    console.error('Login error:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;