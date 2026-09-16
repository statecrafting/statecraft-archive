import { Form, redirect } from "react-router";
import { authSignout } from "../lib/auth-api.server";

export async function action({ request }: { request: Request }) {
  const res = await authSignout(request);
  return redirect("/", {
    headers: { "Set-Cookie": res.setCookie ?? "" },
  });
}

export default function GeneralSettings() {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-3">
          Account
        </h3>
        <Form method="post" encType="application/x-www-form-urlencoded">
          <button
            type="submit"
            className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Sign out
          </button>
        </Form>
      </section>
    </div>
  );
}
