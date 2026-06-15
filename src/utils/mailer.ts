import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (!transporter) {
    const host = process.env.SMTP_HOST || "smtp-relay.brevo.com";
    const port = parseInt(process.env.SMTP_PORT || "587");
    const user = process.env.SMTP_USER || process.env.SMTP_FROM_EMAIL || "riyaratri24@gmail.com";
    const pass = process.env.SMTP_PASS;

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for 587 or other ports
      auth: {
        user,
        pass,
      },
    });
  }
  return transporter;
};

export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    const fromName = process.env.SMTP_FROM_NAME || "RAS Academic Point";
    const fromEmail = process.env.SMTP_FROM_EMAIL || "riyaratri24@gmail.com";

    const mailTransporter = getTransporter();
    await mailTransporter.sendMail({
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

export const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    const fromName = process.env.SMTP_FROM_NAME || "RAS Academic Point";
    const fromEmail = process.env.SMTP_FROM_EMAIL || "riyaratri24@gmail.com";
    const mailTransporter = getTransporter();
    
    await mailTransporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
    });
    console.log(`✉️ [SMTP Email Sent] Successfully sent email to: ${to} | Subject: ${subject}`);
  } catch (error) {
    console.error("❌ Failed to send email via Brevo SMTP:", error);
  }
};

export const sendBookingConfirmation = async (email: string, date: string, time: string, teacherName: string, meetLink?: string) => {
  const subject = "Booking Confirmed - 1-to-1 Session";
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #1f2937;">
      <h2 style="color: #10b981;">Booking Confirmed!</h2>
      <p>Your 1-to-1 session with <strong>${teacherName}</strong> has been confirmed.</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      ${meetLink ? `<p><strong>Google Meet Link:</strong> <a href="${meetLink}">${meetLink}</a></p>` : `<p>The meeting link will be updated soon.</p>`}
      <p>Please be on time!</p>
    </div>
  `;
  await sendEmail(email, subject, html);
};

export const sendWaitlistUpgrade = async (email: string, date: string, time: string, teacherName: string) => {
  const subject = "You got the slot! - 1-to-1 Session";
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #1f2937;">
      <h2 style="color: #10b981;">Great News!</h2>
      <p>A slot just opened up for your waitlisted 1-to-1 session with <strong>${teacherName}</strong>, and you have been automatically upgraded to Booked!</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p>Check your dashboard for the Google Meet link.</p>
    </div>
  `;
  await sendEmail(email, subject, html);
};

