import register from "./register.service.js";
import login from "./login.service.js";
import forgotPassword from "./forgot-password.service.js";
import logout from "./logout.service.js";
import verifyEmail from "./verify-email.service.js";
import refreshToken from "./refresh-token.service.js";

const refreshTokenService = refreshToken;

export {

    register,

    login,

    forgotPassword,

    logout,

    verifyEmail,

    refreshTokenService,

};

export default {

    register,

    login,

    forgotPassword,

    logout,

    verifyEmail,

    refreshToken: refreshTokenService,

};
