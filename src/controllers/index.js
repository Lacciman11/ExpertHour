import {
    register,
    login,
    forgotPassword,
    resetPassword,
    logout,
    verifyEmail,
    resendVerificationEmail,
    logoutAll,
} from "./auth.controller.js";

import {
    getProfile,
    updateProfile,
    changePassword,
    uploadAvatar,
    deleteAvatar,
    deleteAccount,
} from "./profile.controller.js";

import {
    createConsultantProfile,
    getMyConsultantProfile,
    getConsultantProfileById,
    updateConsultantProfile,
    searchConsultants,
    deleteConsultantProfile,
} from "./consultant-profile.controller.js";

import {
    renderResetPasswordPage,
    renderResetSuccessPage,
} from "./auth.page.controller.js";

export {
    register,
    login,
    forgotPassword,
    resetPassword,
    logout,
    verifyEmail,
    resendVerificationEmail,
    logoutAll,
    getProfile,
    updateProfile,
    changePassword,
    uploadAvatar,
    deleteAvatar,
    deleteAccount,
    createConsultantProfile,
    getMyConsultantProfile,
    getConsultantProfileById,
    updateConsultantProfile,
    searchConsultants,
    deleteConsultantProfile,
    renderResetPasswordPage,
    renderResetSuccessPage,
};
