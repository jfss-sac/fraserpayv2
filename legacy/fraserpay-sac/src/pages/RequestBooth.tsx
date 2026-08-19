import React, { ReactNode, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { loginWithGoogle } from "@/contexts/auth/authOperations";
import { toast } from 'sonner';
import { useNavigate } from "react-router-dom";
import { addDoc, collection } from "firebase/firestore";
import { firestore } from "@/integrations/firebase/client";
import {
  canUseRequestBoothDraftStorage,
  clearRequestBoothDraft,
  countRequestBoothSellingDates,
  createEmptyRequestBoothDraft,
  createEmptyRequestBoothProductDraft,
  loadRequestBoothDraft,
  RequestBoothDraft,
  saveRequestBoothDraft,
  validateRequestBoothDraft,
} from "@/utils/requestBoothDraft";

interface SectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

const Section = ({ title, description, children }: SectionProps) => {
  return (
    <div className="w-full rounded-lg bg-gray-100 border-[2px] border-gray-200 p-2 text-pretty">
      <div className="text-xl font-bold">{title}</div>
      <div className="text-slate-600 text-sm">{description}</div>
      <div className="w-full">{children}</div>
    </div>
  );
};

interface StringInputProps {
  label: string;
  description?: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  minChars?: number;
  maxChars?: number;
  required?: boolean;
}

const StringInput = ({
  label,
  description = "",
  type,
  placeholder,
  value,
  onChange,
  minChars = 0,
  maxChars = -1,
  required,
}: StringInputProps) => {
  return (
    <div className="flex flex-col place-items-start gap-y-2 my-4 mx-2">
      <div className="text-gray-600 font-bold text-sm">{label}</div>
      <div className="text-gray-400 text-sm">{description}</div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="p-2 text-sm rounded-lg border-2 border-gray-200 outline-none placeholder-gray-400 focus:bg-gray-200 hover:border-gray-400 focus:border-gray-400 transition-all duration-200"
      />
      <div className="text-sm text-red-500">
        {maxChars !== -1 && value.length > maxChars ? `Character count must not exceed ${maxChars}` : ""}
        {required && value.length === 0 ? "This information is required." : value.length < minChars ? `Character count must be at least ${minChars}` : ""}
      </div>
    </div>
  );
};

interface NumberInputProps {
  label: string;
  description?: string;
  placeholder: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const NumberInput = ({ label, description, placeholder, value, onChange }: NumberInputProps) => {
  const numericValue = Number.parseFloat(value);
  const isInvalid = !value.trim() || Number.isNaN(numericValue) || numericValue <= 0;

  return (
    <div className="flex flex-col place-items-start gap-y-2 my-4 mx-2">
      <div className="text-gray-600 font-bold text-sm">{label}</div>
      <div className="text-gray-400 text-sm">{description}</div>
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="p-2 text-sm rounded-lg border-2 border-gray-200 outline-none placeholder-gray-400 focus:bg-gray-200 hover:border-gray-400 focus:border-gray-400 transition-all duration-200"
      />
      <div className="text-sm text-red-500">{isInvalid ? "Please input a valid price." : ""}</div>
    </div>
  );
};

const autosaveBlockedSessionKey = "requestBoothDraftAutosaveBlockedToastShown";

const RequestBooth = () => {
  const navigate = useNavigate();

  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState("");
  const [draft, setDraft] = useState<RequestBoothDraft>(() => createEmptyRequestBoothDraft());
  const [draftReady, setDraftReady] = useState(false);
  const [draftSyncStatus, setDraftSyncStatus] = useState<"idle" | "restored" | "saved" | "blocked" | "cleared">("idle");
  const [submitStatus, setSubmitStatus] = useState<"error" | "idle" | "submitting" | "success">("idle");

  const skipAutosaveOnceRef = useRef(false);
  const autosaveBlockedRef = useRef(false);
  const autosaveToastShownRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statusStyles = {
    idle: "from-purple-500 to-purple-700 hover:shadow-[0_0_35px_rgba(147,60,227,0.25)]",
    submitting: "from-purple-500 to-purple-700",
    success: "from-green-300 to-green-600 hover:shadow-[0_0_35px_rgba(78,200,123,0.25)]",
    error: "from-red-300 to-red-500",
  };

  const draftBannerStyles = {
    idle: "border-gray-200 bg-gray-50 text-gray-700",
    restored: "border-blue-200 bg-blue-50 text-blue-900",
    saved: "border-emerald-200 bg-emerald-50 text-emerald-900",
    blocked: "border-amber-200 bg-amber-50 text-amber-900",
    cleared: "border-slate-200 bg-slate-50 text-slate-700",
  };

  const CHARITY_WEEK_DATES = [
    "Monday, April 27",
    "Tuesday, April 28",
    "Wednesday, April 29",
    "Thursday, April 30",
    "Friday, May 1",
  ];

  const notifyAutosaveBlockedOnce = () => {
    if (autosaveToastShownRef.current) {
      return;
    }

    try {
      if (sessionStorage.getItem(autosaveBlockedSessionKey) === "1") {
        autosaveToastShownRef.current = true;
        return;
      }

      sessionStorage.setItem(autosaveBlockedSessionKey, "1");
    } catch (error) {
      // Ignore sessionStorage issues and fall back to the in-memory guard.
    }

    autosaveToastShownRef.current = true;
    toast.error("Autosave unavailable", {
      description: "Could not autosave this booth request on this browser or device. You can still submit it manually.",
    });
  };

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn || !signedInEmail) {
      return;
    }

    skipAutosaveOnceRef.current = false;
    autosaveBlockedRef.current = false;
    setDraftReady(false);
    setDraftSyncStatus("idle");

    if (!canUseRequestBoothDraftStorage()) {
      skipAutosaveOnceRef.current = true;
      autosaveBlockedRef.current = true;
      setDraft(createEmptyRequestBoothDraft());
      setDraftReady(true);
      setDraftSyncStatus("blocked");
      notifyAutosaveBlockedOnce();
      return;
    }

    const loadResult = loadRequestBoothDraft(signedInEmail);
    skipAutosaveOnceRef.current = true;
    setDraft(loadResult.draft);
    setDraftReady(true);

    if (loadResult.status === "loaded") {
      setDraftSyncStatus("restored");
      return;
    }

    if (loadResult.status === "blocked") {
      autosaveBlockedRef.current = true;
      setDraftSyncStatus("blocked");
      notifyAutosaveBlockedOnce();
      return;
    }

    setDraftSyncStatus("idle");
  }, [isSignedIn, signedInEmail]);

  useEffect(() => {
    if (!isSignedIn || !signedInEmail || submitStatus !== "idle" || autosaveBlockedRef.current) {
      return;
    }

    if (!draftReady) {
      return;
    }

    if (skipAutosaveOnceRef.current) {
      skipAutosaveOnceRef.current = false;
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      const saveResult = saveRequestBoothDraft(signedInEmail, draft);

      if (saveResult.status === "saved") {
        setDraftSyncStatus("saved");
        return;
      }

      if (saveResult.status === "cleared") {
        setDraftSyncStatus("cleared");
        return;
      }

      autosaveBlockedRef.current = true;
      setDraftSyncStatus("blocked");
      notifyAutosaveBlockedOnce();
    }, 500);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [draft, draftReady, isSignedIn, signedInEmail, submitStatus]);

  const validateDraft = () => validateRequestBoothDraft(draft);
  const isValid = validateDraft();
  const numSellingDates = countRequestBoothSellingDates(draft.sellingDates);

  const handleChangeSellingDates = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      sellingDates: prev.sellingDates.map((isSelling, i) => (i === idx ? !isSelling : isSelling)),
    }));
  };

  const handleChangeProducts = (idx: number, field: "name" | "price", value: string) => {
    setDraft((prev) => ({
      ...prev,
      products: prev.products.map((product, i) => {
        if (i !== idx) {
          return product;
        }

        if (field === "price") {
          if (!/^\d*\.?\d{0,2}$/.test(value)) {
            return product;
          }

          const parsedPrice = Number.parseFloat(value);

          return {
            ...product,
            priceInput: value,
            price: Number.isNaN(parsedPrice) ? 0 : parsedPrice,
          };
        }

        return {
          ...product,
          name: value,
        };
      }),
    }));
  };

  const handleAddProduct = () => {
    setDraft((prev) => ({
      ...prev,
      products: [...prev.products, createEmptyRequestBoothProductDraft()],
    }));
  };

  const handleRemoveProduct = (idx: number) => {
    setDraft((prev) => {
      if (prev.products.length <= 1) {
        return prev;
      }

      return {
        ...prev,
        products: prev.products.filter((_, i) => i !== idx),
      };
    });
  };

  const handleClearDraft = () => {
    const clearResult = signedInEmail ? clearRequestBoothDraft(signedInEmail) : { status: "cleared" as const };

    skipAutosaveOnceRef.current = true;
    setDraftReady(true);
    setDraft(createEmptyRequestBoothDraft());
    setDraftSyncStatus("cleared");
    setSubmitStatus("idle");

    if (clearResult.status === "cleared") {
      autosaveBlockedRef.current = false;
      toast.success("Draft cleared", {
        description: "The local booth request draft was removed from this device.",
      });
      return;
    }

    autosaveBlockedRef.current = true;
    setDraftSyncStatus("blocked");
    notifyAutosaveBlockedOnce();
  };

  const handleSignIn = async () => {
    try {
      console.log("Starting Google sign-in process from UI");
      const userData = await loginWithGoogle();

      if (!userData?.email) {
        toast("Unsuccessful Login", {
          description: "Please create a booth request with a teacher @pdsb.net account.",
        });
        navigate("/login", { replace: true });
        setIsSignedIn(false);
        setSignedInEmail("");
        return;
      }

      const normalizedEmail = userData.email.toLowerCase();
      let isAuthorizedUser = false;
      const authorizedEmails = ["795804@pdsb.net", "752470@pdsb.net", "793546@pdsb.net", "843909@pdsb.net"];

      for (const email of authorizedEmails) {
        if (normalizedEmail === email) {
          isAuthorizedUser = true;
          break;
        }
      }

      if ((normalizedEmail.startsWith("p0") && normalizedEmail.endsWith("@pdsb.net")) || normalizedEmail.endsWith("@peelsb.com") || isAuthorizedUser) {
        console.log("Signed in with", normalizedEmail);
        skipAutosaveOnceRef.current = false;
        autosaveBlockedRef.current = false;
        setDraftReady(false);
        setIsSignedIn(true);
        setSignedInEmail(normalizedEmail);
        setDraft(createEmptyRequestBoothDraft());
        setDraftSyncStatus("idle");
        setSubmitStatus("idle");
        return;
      }

      toast("Unsuccessful Login", {
        description: "Please create a booth request with a teacher @pdsb.net account.",
      });
      navigate("/login", { replace: true });
      setIsSignedIn(false);
      setSignedInEmail("");
      setDraft(createEmptyRequestBoothDraft());
    } catch (error) {
      console.error("Google login error:", error);
    }
  };

  const handleSubmit = async () => {
    if (!isValid) {
      toast.error("Unsuccessful Submission", {
        description: "Please recheck the form for errors before submitting.",
      });
      return;
    }

    setSubmitStatus("submitting");
    const teachersArr = [{ name: draft.respondentName, email: draft.respondentEmail }, ...draft.teachers];
    const productsArr = draft.products.map((product) => ({ name: product.name, price: product.price * 100 }));

    try {
      const boothRequestsCollection = collection(firestore, "booth_requests");
      await addDoc(boothRequestsCollection, {
        teachers: teachersArr,
        boothName: draft.boothName,
        boothDescription: draft.boothDescription,
        groupType: draft.groupType,
        groupInfo: draft.groupInfo,
        products: productsArr,
        status: "pending",
        additionalInformation: draft.additionalInformation,
        sellingDates: draft.sellingDates,
      });

      const clearResult = signedInEmail ? clearRequestBoothDraft(signedInEmail) : { status: "blocked" as const };

      if (clearResult.status === "cleared") {
        setDraftSyncStatus("cleared");
      } else {
        autosaveBlockedRef.current = true;
        setDraftSyncStatus("blocked");
        notifyAutosaveBlockedOnce();
      }

      setSubmitStatus("success");
    } catch (err) {
      toast.error("Unsuccessful Submission", {
        description: "Sorry, something went wrong. Please try again later.",
      });

      setSubmitStatus("error");
    }
  };

  const draftStatusMessage = (() => {
    switch (draftSyncStatus) {
      case "restored":
        return "Draft restored from this device.";
      case "saved":
        return "Draft saved locally.";
      case "blocked":
        return "Autosave unavailable on this browser or device.";
      case "cleared":
        return "Local draft cleared.";
      case "idle":
      default:
        return "Autosave is ready on this device.";
    }
  })();

  const logo = (
    <img
      src="/lovable-uploads/ed1f3f9a-22a0-42de-a8cb-354fb8c82dae.png"
      alt="Fraser Pay"
      className="w-48 h-auto"
    />
  );

  const signedInBody = !draftReady ? (
    <div className="flex w-full flex-col items-stretch gap-y-2">
      <div className="bg-slate-900 text-white p-3 rounded-lg text-pretty">
        This form autosaves locally on this device and browser profile only. Your draft will stay here unless you clear it or the browser storage is reset.
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">Loading your saved draft...</div>
    </div>
  ) : (
    <div className="flex w-full flex-col items-stretch gap-y-2">
      <div className="bg-slate-900 text-white p-3 rounded-lg text-pretty">
        This form autosaves locally on this device and browser profile only. Your draft will stay here unless you clear it or the browser storage is reset.
      </div>

      <div className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${draftBannerStyles[draftSyncStatus]}`}>
        <div className="text-pretty">{draftStatusMessage}</div>
        <button
          type="button"
          onClick={handleClearDraft}
          className="shrink-0 rounded-md border border-current px-3 py-1 text-xs font-semibold hover:bg-black/5 transition-colors duration-200"
        >
          Clear draft
        </button>
      </div>

      <div className="bg-gray-100 border-[2px] border-gray-200 p-2 rounded-lg text-pretty">
        Welcome, teacher! We are very excited to have you join us for charity week. <br />
        <br /> Before you begin filling out this form, ensure you have the following: (you may have to ask your students for some of this information)
        <ul className="list-disc pl-8">
          <li>Your name and email.</li>
          <li>The booth's name. <span className="text-sm text-gray-500">(3-30 characters)</span></li>
          <li>The booth's description. <span className="text-sm text-gray-500">(max 100 characters)</span></li>
          <li>The club or classroom # associated with the booth (if a classroom is running the booth).</li>
          <li>What dates you expect your booth to run on throughout Charity Week.</li>
          <li>A list of all products and their respective prices. <span className="text-sm text-gray-500">(product names max 30 characters)</span></li>
        </ul>
      </div>

      <Section title="Questions?" description="SAC Contact Information">
        <div className="">
          <div className="font-bold mt-2">If you have questions about what to fill in the form:</div>
          <ul className="list-disc pl-8">
            <li>Ms. Sinclair - Teacher - p0042314@pdsb.net</li>
            <li>Hamza - President - 793546@pdsb.net</li>
            <li>David - Vice President - 843909@pdsb.net</li>
            <li>SAC - johnfraserstudentcouncil@gmail.com</li>
          </ul>

          <div className="font-bold mt-2">If you are experiencing technical difficulties with the form:</div>
          <ul className="list-disc pl-8">
            <li>Sohum - Tech Liaison - 795804@pdsb.net</li>
            <li>Yang - Tech Liaison - 752470@pdsb.net</li>
          </ul>
        </div>
      </Section>

      <Section title="Section 1 - Teacher Information" description="We use this information to contact you if we require additional information, or if we need to reach you.">
        <div className="w-full">
          <StringInput
            label="Your Full Name"
            type="text"
            placeholder="Full Name"
            value={draft.respondentName}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                respondentName: e.target.value,
              }))
            }
            required
          />
          <StringInput
            label="Your Email"
            type="email"
            placeholder="Email"
            value={draft.respondentEmail}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                respondentEmail: e.target.value,
              }))
            }
            required
          />
        </div>
      </Section>

      <Section title="Section 2 - Booth Information" description="All booth information">
        <div className="w-full">
          <div>
            <StringInput
              label="Booth Name (max 30 characters)"
              description="This will be the booth name that shows up on FraserPay."
              type="text"
              placeholder="Ex. SAC's Barbeque"
              value={draft.boothName}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  boothName: e.target.value,
                }))
              }
              minChars={3}
              maxChars={30}
              required
            />
            <div className="flex flex-col place-items-center gap-y-2 my-4 mx-2">
              <div className="text-gray-600 font-bold text-sm w-full text-left">Booth Description (optional) (max 100 characters)</div>
              <div className="text-gray-400 text-sm w-full text-left">This will be the booth description that shows up on FraserPay.</div>
              <textarea
                placeholder="Ex. Stop by for some great burgers and hot dogs!"
                value={draft.boothDescription}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    boothDescription: e.target.value,
                  }))
                }
                className="p-2 mx-2 w-full text-sm rounded-lg border-2 border-gray-200 outline-none placeholder-gray-400 focus:bg-gray-200 hover:border-gray-400 focus:border-gray-400 transition-colors duration-200"
              />
              <div className="text-sm text-red-500 w-full text-left">{draft.boothDescription.length > 100 ? "Character count must not exceed 100" : ""}</div>
            </div>
            <div className="flex flex-col place-items-start gap-y-2 my-4 mx-2 relative">
              <div className="text-gray-600 font-bold text-sm">Group Type</div>
              <div className="flex gap-x-2">
                <div
                  className="flex place-items-center p-2 text-sm rounded-lg border-2 border-gray-100 hover:border-black select-none my-1 hover:cursor-pointer transition-all duration-200"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      groupType: "Club",
                    }))
                  }
                  style={{ color: draft.groupType === "Club" ? "white" : "black", backgroundColor: draft.groupType === "Club" ? "black" : "white" }}
                >
                  Club
                </div>
                <div
                  className="flex place-items-center p-2 text-sm rounded-lg border-2 border-gray-100 hover:border-black select-none my-1 hover:cursor-pointer transition-all duration-200"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      groupType: "Class",
                    }))
                  }
                  style={{ color: draft.groupType === "Class" ? "white" : "black", backgroundColor: draft.groupType === "Class" ? "black" : "white" }}
                >
                  Class
                </div>
              </div>
              <div className="text-sm text-red-500">{draft.groupType === "None" ? "Please select a group type." : ""}</div>

              <div className="text-gray-800 text-sm text-pretty">{`Important information for the text box below: If you selected "Club", input the full name of the club (no abbreviations). If you selected "Class", input the room # of the class.`}</div>
              <StringInput
                label="Additional Group Info"
                type="text"
                placeholder="Ex. Student Activity Council"
                value={draft.groupInfo}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    groupInfo: e.target.value,
                  }))
                }
                required
              />
            </div>
          </div>

          <div className="flex flex-col place-items-start gap-y-2 my-4 mx-2 relative">
            <div className="text-gray-600 font-bold text-sm">Selling Dates</div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {draft.sellingDates.map((_, i) => (
                <div
                  key={i}
                  className="flex place-items-center p-2 text-xs rounded-lg border-2 border-gray-100 hover:border-black select-none my-1 hover:cursor-pointer transition-all duration-200"
                  style={{ color: draft.sellingDates[i] ? "white" : "black", backgroundColor: draft.sellingDates[i] ? "black" : "white" }}
                  onClick={() => handleChangeSellingDates(i)}
                >
                  {CHARITY_WEEK_DATES[i]}
                </div>
              ))}
            </div>
            <div className="text-sm text-red-500">{numSellingDates === 0 ? "Please select at least one day to run your booth." : ""}</div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="py-1">
              <div>Products</div>
              {draft.products.map((product, i) => (
                <div key={i}>
                  <div className="my-8 flex place-items-center">
                    <div>
                      <StringInput
                        label={`Product #${i + 1} - Name (max 30 characters)`}
                        description="This will be visible on FraserPay."
                        type="text"
                        placeholder="Product Name"
                        value={product.name}
                        onChange={(e) => handleChangeProducts(i, "name", e.target.value)}
                        required
                      />
                      <NumberInput
                        label={`Product #${i + 1} - Price ($)`}
                        description="This will be visible on FraserPay."
                        placeholder="Price"
                        value={product.priceInput}
                        onChange={(e) => handleChangeProducts(i, "price", e.target.value)}
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => handleRemoveProduct(i)}
                        className="px-2 text-center font-bold rounded-sm hover:bg-red-500 hover:text-white"
                        style={{ display: draft.products.length > 1 ? "block" : "none" }}
                      >
                        x
                      </button>
                    </div>
                  </div>
                  <hr className="border-[1px]" />
                </div>
              ))}
            </div>
            <div>
              <button
                type="button"
                onClick={handleAddProduct}
                className="font-bold p-1 border-2 border-black rounded-lg text-sm hover:bg-black hover:text-white transition-all duration-200"
              >
                Add Product
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Section 3 - Additional Information" description="Any additional information you would like SAC to know about your request">
        <div className="flex flex-col place-items-center gap-y-2 my-4 mx-2">
          <div className="text-sm w-full text-left">
            Please do not use this area to ask questions. If you have any questions, you are welcome to use the contact information at the top of the form. If your booth <b>
              <u>REQUIRES</u>
            </b>{" "}
            any accommodations, let us know here. We do not do spot requests. If there is any other information you feel we should know, you are welcome to write it here.
          </div>
          <textarea
            placeholder="Ex. We are using a barbeque grill. We need to be placed outside and close to an outlet."
            value={draft.additionalInformation}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                additionalInformation: e.target.value,
              }))
            }
            className="p-2 mx-2 w-full text-sm rounded-lg border-2 border-gray-200 outline-none placeholder-gray-400 focus:bg-gray-200 hover:border-gray-400 focus:border-gray-400 transition-colors duration-200"
          />
        </div>
      </Section>

      <Section title="Section 4 - Reimbursments" description="">
        <div className="text-sm w-full text-left my-4 mx-2">
          All initiatives may request reimbursement of up to $50. To be reimbursed, teachers must provide a receipt to the office. If your initiative requires more than $50, please reach out to Mrs. Sinclair at{" "}
          <a href="mailto:heather.sinclair@peelsb.com" className="underline text-blue-600 hover:text-blue-800">
            heather.sinclair@peelsb.com
          </a>
          .
        </div>
      </Section>

      <button
        onClick={handleSubmit}
        className={`mt-8 w-full max-w-xs self-center bg-gradient-to-r ${statusStyles[submitStatus]} p-2 text-white font-bold rounded-lg transition-all duration-100 outline-none`}
        disabled={submitStatus !== "idle" || !isValid}
        style={{
          cursor: submitStatus === "idle" && isValid ? "pointer" : "not-allowed",
        }}
      >
        {submitStatus === "idle" ? "Submit" : submitStatus === "error" ? "Error" : submitStatus === "submitting" ? "Submitting..." : "Success!"}
      </button>
      <div className="text-sm text-red-500 text-center text-balance">
        {!isValid ? "You cannot submit right now due to information being incorrectly or incompletely filled. Please recheck the form for any errors with your responses. Please contact SAC if you think this message is a mistake." : ""}
      </div>
      <div
        className="mx-auto w-full max-w-[500px] text-sm text-balance bg-gradient-to-r from-purple-300 to-purple-600 p-2 rounded-lg text-center font-bold text-white"
        style={{ display: submitStatus === "success" ? "block" : "none" }}
      >
        Thank you for submitting your booth to be reviewed! SAC will be in touch with you in the coming weeks. Do not hesitate to reach out to SAC should any questions arise!
      </div>
    </div>
  );

  const signedOutBody = (
    <div className="w-full">
      <button
        onClick={async () => await handleSignIn()}
        className="w-full flex items-center justify-center gap-2 border-2 border-gray-300 bg-gray-50 text-gray-700 hover:border-gray-400 hover:bg-gray-100 transition-all duration-200 p-2 rounded-lg"
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" className="h-5 w-5">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Sign in using Google
      </button>
      <div className="text-sm text-gray-500 text-center mt-4">Only teacher accounts ending in @pdsb.net or @peelsb.com is allowed.</div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-background to-muted/30 animate-fade-in">
      <div className="mb-8">{logo}</div>
      <div className="w-full flex justify-center">
        <Card className={`w-full ${isSignedIn ? "max-w-[900px]" : "max-w-md"} shadow-lg border-opacity-50`}>
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl font-bold">FraserPay Booth Request Form</CardTitle>
            <CardDescription>{isSignedIn ? "Complete the fields below to submit your booth request." : "Sign in with a teacher account to request a booth."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">{isSignedIn ? signedInBody : signedOutBody}</CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RequestBooth;
