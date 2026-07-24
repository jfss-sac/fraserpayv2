import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { OfflineBanner } from "./offline-banner";

test("renders an assertive, unmissable offline alert", () => {
  render(<OfflineBanner />);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveAttribute("aria-live", "assertive");
  expect(alert).toHaveTextContent("You're offline");
  expect(alert).toHaveTextContent(/resumes automatically when you reconnect/i);
});
