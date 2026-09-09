import authRoutes from "./auth.routes.js";
import authPageRoutes from "./auth.page.routes.js";
import profileRoutes from "./profile.routes.js";
import consultantProfileRoutes from "./consultant-profile.routes.js";
import bookingRoutes from "./booking.routes.js";
import categoryRoutes from "./category.routes.js";
import paymentRoutes from "./payment.routes.js";
import googleCalendarRoutes from "./google-calendar.routes.js";
import adminRoutes from "./admin.routes.js";
import reviewRoutes from "./review.routes.js";
import consultationSessionRoutes from "./consultation-session.routes.js";
import consultantEarningRoutes from "./consultant-earning.routes.js";
import payoutRoutes from "./payout.routes.js";
import applicationRoutes from "./application.routes.js";

const routes = [
    { path: "/api/v1/auth", router: authRoutes },
    { path: "/api/v1/profile", router: profileRoutes },
    { path: "/api/v1/consultant", router: consultantProfileRoutes },
    { path: "/api/v1/bookings", router: bookingRoutes },
    { path: "/api/v1/categories", router: categoryRoutes },
    { path: "/api/v1/payments", router: paymentRoutes },
    { path: "/api/v1/google-calendar", router: googleCalendarRoutes },
    { path: "/api/v1/admin", router: adminRoutes },
    { path: "/api/v1/reviews", router: reviewRoutes },
    { path: "/api/v1/sessions", router: consultationSessionRoutes },
    { path: "/api/v1/earnings", router: consultantEarningRoutes },
    { path: "/api/v1/payouts", router: payoutRoutes },
    { path: "/api/v1/applications", router: applicationRoutes },
    { path: "/auth", router: authPageRoutes },
];

const registerRoutes = (app) => {

    routes.forEach(({ path, router }) => {

        app.use(path, router);

    });

    return app;

};

export default registerRoutes;
