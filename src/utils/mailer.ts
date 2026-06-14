import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST || "smtp-relay.brevo.com";
const port = parseInt(process.env.SMTP_PORT || "587");
const user = process.env.SMTP_FROM_EMAIL || "riyaratri24@gmail.com";
const pass = process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: false, // true for 465, false for other ports
  auth: {
    user,
    pass,
  },
});

export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    const fromName = process.env.SMTP_FROM_NAME || "RAS Academic Point";
    const fromEmail = process.env.SMTP_FROM_EMAIL || "riyaratri24@gmail.com";

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: "Verification OTP - RAS Academic Point",
      text: `Your OTP is: ${otp}. It will expire in 5 minutes.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 500px; margin: auto; background-color: #ffffff; color: #1f2937;">
          <h2 style="color: #10b981; text-align: center; margin-bottom: 24px;">RAS Academic Point</h2>
          <p style="font-size: 16px; line-height: 24px;">Hello,</p>
          <p style="font-size: 16px; line-height: 24px;">Your verification code is:</p>
          <div style="font-size: 28px; font-weight: bold; text-align: center; padding: 16px; background-color: #f3f4f6; border-radius: 8px; letter-spacing: 4px; margin: 24px 0; color: #111827;">
            ${otp}
          </div>
          <p style="color: #6b7280; font-size: 14px; line-height: 20px; margin-top: 24px;">This code is valid for 5 minutes. If you did not request this verification, please ignore this message.</p>
        </div>
      `,
    });
    console.log(`✉️ [SMTP Email Sent] Successfully sent OTP to: ${email} | OTP: ${otp}`);
  } catch (error) {
    console.error("❌ Failed to send email via Brevo SMTP:", error);
  }
};
