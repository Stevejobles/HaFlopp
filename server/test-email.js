const nodemailer = require('nodemailer');

async function testEmail() {
  // Create transporter with your credentials
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    debug: true
  });
  
  // Verify connection
  try {
    const isVerified = await transporter.verify();
    console.log('SMTP connection verified:', isVerified);
  } catch (error) {
    console.error('SMTP verification failed:', error);
    return;
  }
  
  // Send test email
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: 'your-test-email@example.com',
      subject: 'Test Email',
      text: 'If you can read this, your email setup is working!'
    });
    
    console.log('Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

testEmail();