import { Service } from "encore.dev/service";

// The db service has no endpoints; it exists to own the single SQLDatabase("app")
// resource and its migrations (spec 002). Other services import `db` from ./db.
export default new Service("db");
