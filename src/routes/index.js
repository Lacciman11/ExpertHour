import authRoutes from "./auth.routes.js";
import authPageRoutes from "./auth.page.routes.js";

const routes = [
    { path: "/api/v1/auth", router: authRoutes },
    { path: "/auth", router: authPageRoutes },
];

const registerRoutes = (app) => {

    routes.forEach(({ path, router }) => {

        app.use(path, router);

    });

    return app;

};

export default registerRoutes;
