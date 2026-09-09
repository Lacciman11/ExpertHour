const errorHandler = (err, req, res, next) => {

    // Handle Multer errors (file upload errors)
    if (err.code === "LIMIT_FILE_SIZE") {

        return res.status(400).json({
            success: false,
            message: "File size exceeds the maximum limit of 10MB"
        });

    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {

        return res.status(400).json({
            success: false,
            message: "Unexpected file field"
        });

    }

    // Handle custom file filter errors
    if (err.message && err.message.includes("Invalid file type")) {

        return res.status(400).json({
            success: false,
            message: err.message
        });

    }

    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message: err.message || "Internal Server Error"
    });

};

export default errorHandler;