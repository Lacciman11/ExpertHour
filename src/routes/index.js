import authRoutes from "./auth.routes.js";
import authPageRoutes from "./auth.page.routes.js";
import profileRoutes from "./profile.routes.js";
import consultantProfileRoutes from "./consultant-profile.routes.js";

const routes = [
    { path: "/api/v1/auth", router: authRoutes },
    { path: "/api/v1/profile", router: profileRoutes },
    { path: "/api/v1/consultant", router: consultantProfileRoutes },
    { path: "/auth", router: authPageRoutes },
];

const registerRoutes = (app) => {

    routes.forEach(({ path, router }) => {

        app.use(path, router);

    });

    return app;

};

export default registerRoutes;
