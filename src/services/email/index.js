import emailService from "./email.service.js";
import forgotPasswordTemplate from "./templates/forgot-password.template.js";
import verifyEmailTemplate from "./templates/verify-email.template.js";
import paymentSuccessTemplate from "./templates/payment-success.template.js";
import paymentFailureTemplate from "./templates/payment-failure.template.js";
import paymentSuccessConsultantTemplate from "./templates/payment-success.consultant.template.js";
import paymentFailureConsultantTemplate from "./templates/payment-failure.consultant.template.js";
import consultantApprovalTemplate from "./templates/consultant-approval.template.js";
import consultantRejectionTemplate from "./templates/consultant-rejection.template.js";
import bookingCancelledTemplate from "./templates/booking-cancelled.template.js";
import bookingDeclinedTemplate from "./templates/booking-declined.template.js";
import refundCompletedTemplate from "./templates/refund-completed.template.js";
import refundFailedTemplate from "./templates/refund-failed.template.js";
import payoutCompletedTemplate from "./templates/payout-completed.template.js";
import payoutFailedTemplate from "./templates/payout-failed.template.js";
import sessionCompletedTemplate from "./templates/session-completed.template.js";
import reviewReceivedTemplate from "./templates/review-received.template.js";
import earningCancelledTemplate from "./templates/earning-cancelled.template.js";
import bookingReminderTemplate from "./templates/booking-reminder.template.js";
import reviewRequestTemplate from "./templates/review-request.template.js";

export {
    emailService,
    forgotPasswordTemplate,
    verifyEmailTemplate,
    paymentSuccessTemplate,
    paymentFailureTemplate,
    paymentSuccessConsultantTemplate,
    paymentFailureConsultantTemplate,
    consultantApprovalTemplate,
    consultantRejectionTemplate,
    bookingCancelledTemplate,
    bookingDeclinedTemplate,
    refundCompletedTemplate,
    refundFailedTemplate,
    payoutCompletedTemplate,
    payoutFailedTemplate,
    sessionCompletedTemplate,
    reviewReceivedTemplate,
    earningCancelledTemplate,
    bookingReminderTemplate,
    reviewRequestTemplate,
};
