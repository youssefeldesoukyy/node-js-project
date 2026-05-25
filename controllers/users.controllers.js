const asyncWrapper = require("../middleware/asyncWrapper");
const User = require('../models/user.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');
const bcrypt = require('bcrypt');
const generateJWT = require("../utils/generateJwt");
const { sendEmail, isDevEmailLogMode } = require('../utils/sendEmail');
const {
    generateResetToken,
    hashResetToken,
    buildPasswordResetLink,
} = require('../utils/passwordReset');

const RESET_TOKEN_MS = 60 * 60 * 1000;

const getAllUsers = asyncWrapper(async (req, res) => {
    const query = req.query;
    const limit = query.limit || 10;
    const page = query.page || 1;
    const skip = (page - 1) * limit;

    const users = await User.find({}, {
        "__v": false,
        password: false,
        token: false,
        passwordResetToken: false,
        passwordResetExpires: false,
    }).limit(limit).skip(skip);
    res.json({ status: httpStatusText.SUCCESS, data: { users } });
})

const register = asyncWrapper(async (req, res, next) => {
    const { firstName, lastName, email, password, phone, address, role } = req.body;

    // التحقق من البيانات المطلوبة
    if (!firstName || !lastName || !email || !password) {
        const error = appError.create('firstName, lastName, email and password are required', 400, httpStatusText.FAIL);
        return next(error);
    }

    // التحقق من إن اليوزر مش موجود
    const oldUser = await User.findOne({ email });
    if (oldUser) {
        const error = appError.create('user already exists', 400, httpStatusText.FAIL);
        return next(error);
    }

    // تشفير الباسورد
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
        firstName,
        lastName,
        email,
        password: hashedPassword,
        phone,
        address,
        role
    });

    // توليد الـ token
    const token = await generateJWT({ email: newUser.email, id: newUser._id, role: newUser.role });
    newUser.token = token;

    await newUser.save();

    res.status(201).json({
        status: httpStatusText.SUCCESS,
        data: {
            token,
            user: {
                id: newUser._id,
                email: newUser.email,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                role: newUser.role,
            },
        },
    });
})

const login = asyncWrapper(async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
        const error = appError.create('email and password are required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const user = await User.findOne({ email });
    if (!user) {
        const error = appError.create('user not found', 400, httpStatusText.FAIL);
        return next(error);
    }

    const matchedPassword = await bcrypt.compare(password, user.password);

    if (user && matchedPassword) {
        const token = await generateJWT({ email: user.email, id: user._id, role: user.role });
        return res.json({
            status: httpStatusText.SUCCESS,
            data: {
                token,
                user: {
                    id: user._id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                },
            },
        });
    } else {
        const error = appError.create('email or password is wrong', 400, httpStatusText.FAIL);
        return next(error);
    }
})

const forgotPassword = asyncWrapper(async (req, res, next) => {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email) {
        const error = appError.create('email is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const user = await User.findOne({ email });
    const genericMessage =
        'If an account exists for that email, we sent a link to reset your password.';

    if (user) {
        const rawToken = generateResetToken();
        user.passwordResetToken = hashResetToken(rawToken);
        user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_MS);
        await user.save({ validateBeforeSave: false });

        const resetLink = buildPasswordResetLink(rawToken);
        const appName = process.env.APP_NAME || 'Thrift It';

        try {
            const mailResult = await sendEmail({
                to: user.email,
                subject: `${appName} — reset your password`,
                text:
                    `Hi ${user.firstName || 'there'},\n\n` +
                    `We received a request to reset your password.\n\n` +
                    `Open this link (valid for 1 hour):\n${resetLink}\n\n` +
                    `If you did not request this, you can ignore this email.\n\n` +
                    `— ${appName}`,
                html:
                    `<p>Hi ${user.firstName || 'there'},</p>` +
                    `<p>We received a request to reset your password.</p>` +
                    `<p><a href="${resetLink}">Reset your password</a> (link valid for 1 hour)</p>` +
                    `<p>If you did not request this, you can ignore this email.</p>` +
                    `<p>— ${appName}</p>`,
            });
            if (!mailResult.delivered) {
                if (mailResult.logged && isDevEmailLogMode()) {
                    console.log('\n[password-reset] Reset link (copy from terminal above, or use this URL):');
                    console.log(resetLink);
                    console.log('[password-reset] Valid for 1 hour.\n');
                } else {
                    throw new Error('SMTP not configured');
                }
            }
        } catch (mailErr) {
            const isDev = process.env.NODE_ENV !== 'production';
            const outlookBlocked = /basic authentication is disabled|5\.7\.139/i.test(
                mailErr.message || ''
            );

            if (isDev) {
                console.warn('[password-reset] Email failed:', mailErr.message);
                console.log('\n[password-reset] Dev fallback — open this link in your browser:');
                console.log(resetLink);
                console.log('[password-reset] Valid for 1 hour.\n');
            } else {
                user.passwordResetToken = undefined;
                user.passwordResetExpires = undefined;
                await user.save({ validateBeforeSave: false });
            }

            if (!isDev) {
                let hint =
                    'Could not send reset email. Set RESEND_API_KEY or SMTP credentials in backend .env.';
                if (outlookBlocked) {
                    hint =
                        'Hotmail SMTP no longer supports app passwords. Add RESEND_API_KEY from resend.com (free) to .env instead.';
                } else if (/only send testing emails to your own email/i.test(mailErr.message || '')) {
                    hint =
                        'Resend testing mode: use the same email you used to sign up at resend.com, or verify a domain at resend.com/domains.';
                } else if (mailErr.message) {
                    hint = mailErr.message;
                }
                return next(appError.create(hint, 503, httpStatusText.FAIL));
            }
        }
    }

    res.json({
        status: httpStatusText.SUCCESS,
        data: { message: genericMessage },
    });
});

const resetPassword = asyncWrapper(async (req, res, next) => {
    const { token, password } = req.body;
    const rawToken = String(token || '').trim();

    if (!rawToken || !password) {
        const error = appError.create('token and password are required', 400, httpStatusText.FAIL);
        return next(error);
    }

    if (String(password).length < 6) {
        const error = appError.create('password must be at least 6 characters', 400, httpStatusText.FAIL);
        return next(error);
    }

    const hashedToken = hashResetToken(rawToken);
    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetToken +passwordResetExpires +password');

    if (!user) {
        const error = appError.create('reset link is invalid or has expired', 400, httpStatusText.FAIL);
        return next(error);
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.token = undefined;
    await user.save();

    res.json({
        status: httpStatusText.SUCCESS,
        data: { message: 'Password updated. You can log in with your new password.' },
    });
});

module.exports = {
    getAllUsers,
    register,
    login,
    forgotPassword,
    resetPassword,
};