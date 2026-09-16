import { Service } from "encore.dev/service";

/**
 * Deploy service: proxies deployment requests to deployd-api using OIDC M2M auth.
 * Absorbs the former statecraft-api functionality.
 */
export default new Service("deploy");
