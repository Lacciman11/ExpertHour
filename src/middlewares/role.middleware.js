import ApiError from "../utils/ApiError.js";

const authorize = (...allowedRoles) => {

    return (req, res, next) => {

        if (!req.user) {

            throw new ApiError(401, "Unauthorized");

        }

        if (!allowedRoles.includes(req.user.role)) {

            throw new ApiError(403, "Forbidden: You do not have permission to access this resource");

        }

        next();

    };

};

export default authorize;
