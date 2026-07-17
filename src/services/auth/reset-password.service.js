import ApiError from "../../utils/ApiError.js";

import User from "../../models/User.js";

import passwordResetTokenService 
    from "../password-reset-token.service.js";

import sessionService 
    from "../session.service.js";


class ResetPasswordService {


    async execute({
        token,
        password,
    }) {


        /*
        |--------------------------------------------------------------------------
        | Validate token (reuses the same logic as the page controller)
        |--------------------------------------------------------------------------
        */

        const validation =
            await passwordResetTokenService.validateToken(
                token
            );


        if (!validation.valid) {

            const status =
                validation.reason === "expired"
                    ? 410
                    : validation.reason === "used"
                        ? 410
                        : 400;

            const message =
                validation.reason === "expired"
                    ? "Reset token expired"
                    : validation.reason === "used"
                        ? "Reset token already used"
                        : "Invalid or expired reset token";

            throw new ApiError(
                status,
                message
            );

        }


        const resetToken = validation.token;


        /*
        |--------------------------------------------------------------------------
        | Update Password
        |
        | Re-fetch the user explicitly with the password field selected so the
        | document is fully loaded before mutation (avoids relying on the
        | populate result where `password` is `select:false`).
        |--------------------------------------------------------------------------
        */

        const user = await User
            .findById(resetToken.user._id)
            .select("+password");


        if (!user) {

            throw new ApiError(
                400,
                "Invalid or expired reset token"
            );

        }


        user.password = password;


        await user.save();



        /*
        |--------------------------------------------------------------------------
        | Mark Token Used
        |--------------------------------------------------------------------------
        */

        await passwordResetTokenService.markAsUsed(
            resetToken._id
        );



        /*
        |--------------------------------------------------------------------------
        | Remove Other Reset Tokens
        |--------------------------------------------------------------------------
        */

        await passwordResetTokenService.deleteUserTokens(
            user._id
        );



        /*
        |--------------------------------------------------------------------------
        | Logout All Devices
        |--------------------------------------------------------------------------
        */

        await sessionService.revokeAllSessions(
            user._id
        );


        return user;

    }


}


export default new ResetPasswordService();