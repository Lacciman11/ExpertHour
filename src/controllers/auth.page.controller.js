import path from "path";
import { fileURLToPath } from "url";

import asyncHandler from "../utils/asyncHandler.js";

import { passwordResetTokenService }
    from "../services/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const renderResetPasswordPage = asyncHandler(async (req, res) => {

    const { token } = req.query;

    /*
    |--------------------------------------------------------------------------
    | No Token Provided
    |--------------------------------------------------------------------------
    */

    if (!token) {

        return res.sendFile(
            path.join(
                __dirname,
                "../views/auth/invalid-token.html"
            )
        );

    }

    /*
    |--------------------------------------------------------------------------
    | Validate Token
    |--------------------------------------------------------------------------
    */

    const validation =
        await passwordResetTokenService.validateToken(
            token
        );

    /*
    |--------------------------------------------------------------------------
    | Invalid Token
    |--------------------------------------------------------------------------
    */

    if (!validation.valid) {

        if (validation.reason === "expired") {

            return res.sendFile(
                path.join(
                    __dirname,
                    "../views/auth/expired-token.html"
                )
            );

        }

        return res.sendFile(
            path.join(
                __dirname,
                "../views/auth/invalid-token.html"
            )
        );

    }

    /*
    |--------------------------------------------------------------------------
    | Valid Token
    |--------------------------------------------------------------------------
    */

    return res.sendFile(
        path.join(
            __dirname,
            "../views/auth/reset-password.html"
        )
    );

});

export const renderResetSuccessPage = asyncHandler(async (req, res) => {

    return res.sendFile(
        path.join(
            __dirname,
            "../views/auth/reset-success.html"
        )
    );

});
