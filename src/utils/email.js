const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('📧 [DEV] Email skipped (no credentials). Would send to:', to);
      console.log('Subject:', subject);
      return { success: true, messageId: 'dev-mode' };
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });

    console.log('📧 Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email error:', error.message);
    return { success: false, error: error.message };
  }
};

// Pre-built templates
const templates = {
  loanApplication: (memberName, amount, purpose) => ({
    subject: `New Loan Application - ${memberName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">New Loan Application (Qard Hasan)</h2>
        <p><strong>Member:</strong> ${memberName}</p>
        <p><strong>Amount:</strong> ৳${amount.toLocaleString()}</p>
        <p><strong>Purpose:</strong> ${purpose || 'Not specified'}</p>
        <p>Please log in to the dashboard to review and start the voting process.</p>
        <a href="${process.env.CLIENT_URL}/manager/loans" style="background:#0f766e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">Review Application</a>
      </div>
    `,
  }),

  votingStarted: (loanId, memberName, amount) => ({
    subject: `Vote Required: Loan Application from ${memberName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Your Vote is Needed</h2>
        <p>A loan application has been submitted by <strong>${memberName}</strong> for <strong>৳${amount.toLocaleString()}</strong>.</p>
        <p>Please cast your vote (Approve / Reject) in the app.</p>
        <a href="${process.env.CLIENT_URL}/member/vote/${loanId}" style="background:#0f766e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">Cast Your Vote</a>
        <p style="margin-top:20px;font-size:13px;color:#666;">Approval requires ≥67% yes votes from members.</p>
      </div>
    `,
  }),

  loanApproved: (memberName, amount) => ({
    subject: `✅ Loan Approved - ৳${amount.toLocaleString()}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Congratulations! Your Loan is Approved</h2>
        <p>Dear ${memberName},</p>
        <p>Your Qard Hasan loan request of <strong>৳${amount.toLocaleString()}</strong> has been approved by the members.</p>
        <p>The manager will disburse the amount shortly. You will receive another notification once the money is sent.</p>
      </div>
    `,
  }),

  loanRejected: (memberName, amount) => ({
    subject: `Loan Application Update`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Loan Application Not Approved</h2>
        <p>Dear ${memberName},</p>
        <p>Your loan request of <strong>৳${amount.toLocaleString()}</strong> did not receive the required 67% approval.</p>
        <p>You may discuss with the manager or re-apply later if eligible.</p>
      </div>
    `,
  }),

  savingRequest: (memberName, amount, method, trxId) => ({
    subject: `New Saving Placement Request - ${memberName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">New Saving Request</h2>
        <p><strong>Member:</strong> ${memberName}</p>
        <p><strong>Amount:</strong> ৳${amount.toLocaleString()}</p>
        <p><strong>Method:</strong> ${method}</p>
        <p><strong>Transaction ID:</strong> ${trxId || 'N/A'}</p>
        <a href="${process.env.CLIENT_URL}/manager/savings" style="background:#0f766e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">Review Request</a>
      </div>
    `,
  }),

  savingConfirmed: (memberName, amount) => ({
    subject: `✅ Saving Confirmed - ৳${amount.toLocaleString()}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Saving Confirmed</h2>
        <p>Dear ${memberName},</p>
        <p>Your saving of <strong>৳${amount.toLocaleString()}</strong> has been confirmed and added to the central fund.</p>
        <p>Thank you for your contribution!</p>
      </div>
    `,
  }),

  savingDenied: (memberName, amount, reason) => ({
    subject: `Saving Request Needs Attention`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d97706;">Saving Request Denied</h2>
        <p>Dear ${memberName},</p>
        <p>Your saving request of <strong>৳${amount.toLocaleString()}</strong> was denied.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>You can edit and resubmit the request from your dashboard.</p>
        <a href="${process.env.CLIENT_URL}/member/savings" style="background:#0f766e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">Update Request</a>
      </div>
    `,
  }),

  loanDisbursed: (memberName, amount) => ({
    subject: `💰 Loan Disbursed - Please Confirm Receipt`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Loan Amount Sent</h2>
        <p>Dear ${memberName},</p>
        <p>The manager has disbursed <strong>৳${amount.toLocaleString()}</strong> to you.</p>
        <p>Please confirm receipt in the app. If there is any issue, you can report it (this will not reverse the fund balance).</p>
        <a href="${process.env.CLIENT_URL}/member/loans" style="background:#0f766e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">Confirm Receipt</a>
      </div>
    `,
  }),

  reVoteNotification: (loanId, memberName) => ({
    subject: `Re-vote Requested for a Loan Application`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Re-vote Opportunity</h2>
        <p>The manager has opened a re-vote for members who previously rejected the loan of <strong>${memberName}</strong>.</p>
        <p>Please reconsider and cast your vote again.</p>
        <a href="${process.env.CLIENT_URL}/member/vote/${loanId}" style="background:#0f766e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">Vote Again</a>
      </div>
    `,
  }),
};

module.exports = { sendEmail, templates };
