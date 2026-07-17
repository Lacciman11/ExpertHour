import {
    register,
    login,
    forgotPassword,
    resetPassword,
    logout,
} from "./auth.controller.js";

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
    renderResetPasswordPage,
    renderResetSuccessPage,
};
