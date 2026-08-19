import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from "@/components/ui/card";
import { Check, RefreshCcw, ScanEye, X } from "lucide-react";
import { BoothRequest } from "@/types";
import { useEffect, useState } from "react";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import { firestore } from "@/integrations/firebase/client";
import { toast } from 'sonner';
import { useAuth } from "@/contexts/auth";
interface BoothRequestsListProps {
    boothRequests: BoothRequest[];
    refresh: () => void;
}
const BoothRequestsList = ({
    boothRequests = [],
    refresh,
}: BoothRequestsListProps) => {
    console.log(boothRequests);

    const { user } = useAuth();

    const [displayApproveConfirmation, setDisplayApproveConfirmation] =
        useState<boolean[]>(Array(boothRequests.length).fill(false));
    const [approveLoading, setApproveLoading] = useState<boolean[]>(
        Array(boothRequests.length).fill(false),
    );

    const CHARITY_WEEK_DATES = [
        "Monday, April 27",
        "Tuesday, April 28",
        "Wednesday, April 29",
        "Thursday, April 30",
        "Friday, May 1",
    ];

    let approvedArr = [];
    for (const req of boothRequests) {
        approvedArr.push(req.status === "approved");
    }
    const [approved, setApproved] = useState<boolean[]>(approvedArr);

    const [activeInspectModal, setActiveInspectModal] = useState(-1);
    const [activeApproveModal, setActiveApproveModal] = useState(-1);
    const [selectedFilter, setSelectedFilter] = useState<
        "all" | "approved" | "pending"
    >("pending");

    const [PIN, setPIN] = useState("");
    const [foundUniquePIN, setFoundUniquePIN] = useState(false);
    const [membersFound, setMembersFound] = useState([]);
    const [isAllGood, setAllGood] = useState(false);

    const handleClickApprove = async (idx: number) => {
        if (!displayApproveConfirmation[idx]) {
            setDisplayApproveConfirmation((prev) =>
                prev.map((x, i) => (i !== idx ? x : true)),
            );
            setTimeout(
                () =>
                    setDisplayApproveConfirmation((prev) =>
                        prev.map((x, i) => (i !== idx ? x : false)),
                    ),
                3000,
            );
        } else {
            // create booth
            try {
                let allGood = true;
                setDisplayApproveConfirmation((prev) =>
                    prev.map((x, i) => (i !== idx ? x : false)),
                );
                setApproveLoading((prev) =>
                    prev.map((x, i) => (i !== idx ? x : true)),
                );
                setActiveApproveModal(idx);

                // get a unique PIN
                const boothsCollection = collection(firestore, "booths");
                let pin: string = Math.floor(
                    100000 + Math.random() * 900000,
                ).toString();
                let boothsPINQuery = query(
                    boothsCollection,
                    where("pin", "==", pin),
                );
                let boothsPINSnapshot = await getDocs(boothsPINQuery);
                let count = 0;

                while (!boothsPINSnapshot.empty && count < 3) {
                    pin = Math.floor(
                        100000 + Math.random() * 900000,
                    ).toString();
                    boothsPINQuery = query(
                        boothsCollection,
                        where("pin", "==", pin),
                    );
                    boothsPINSnapshot = await getDocs(boothsPINQuery);
                    count++;
                }

                setFoundUniquePIN(count < 3);
                if (count < 3) {
                    setPIN(pin);
                } else {
                    allGood = false;
                    console.log("NO UNIQUE PIN");
                }
                // find all members mentioned
                const usersCollection = collection(firestore, "users");

                // add all teacher emails
                let teachersArr = [];
                for (const teacher of boothRequests[idx].teachers) {
                    teachersArr.push(teacher.email);
                }
                console.log("ALL GOOD? ", allGood);
                if (allGood) {
                    // add booth (no products yet)
                    const newBooth = await addDoc(boothsCollection, {
                        created_at: serverTimestamp(),
                        updated_at: serverTimestamp(),
                        created_by: user.id,
                        name: boothRequests[idx].boothName,
                        description: boothRequests[idx].boothDescription,
                        pin: pin,
                        sales: 0,
                        teachers: teachersArr,
                    });

                    // make product objects out of products array
                    let productsArr = [];
                    for (const product of boothRequests[idx].products) {
                        productsArr.push({
                            boothId: newBooth.id,
                            id:
                                Date.now().toString(36) +
                                Math.random().toString(36).substring(2),
                            description: "",
                            image: "",
                            name: product.name,
                            price: product.price,
                            salesCount: 0,
                        });
                    }

                    // add products to booth
                    await updateDoc(newBooth, {
                        products: productsArr,
                    });

                    // update status of this booth request
                    const boothRequestRef = doc(
                        firestore,
                        "booth_requests",
                        boothRequests[idx].id,
                    );

                    await updateDoc(boothRequestRef, {
                        status: "approved",
                    });

                    setApproved((prev) =>
                        prev.map((x, i) => (i !== idx ? x : true)),
                    );

                    setAllGood(true);
                    await refreshBoothRequests();
                }
            } catch (error) {
                console.error(error);
                toast.error("Something went wrong", {
                    description: `That booth could not be approved. Error message: ${error}`,
                });
            } finally {
                setApproveLoading((prev) =>
                    prev.map((x, i) => (i !== idx ? x : false)),
                );
            }
        }
    };

    const handleClickInspect = (idx: number) => {
        setActiveInspectModal(idx);
    };

    const handleCloseApproveModal = () => {
        setActiveApproveModal(-1);
        setFoundUniquePIN(false);
        setMembersFound([]);
        setPIN("");
        setAllGood(false);
    };

    const refreshBoothRequests = async () => {
        console.log("hello");
        localStorage.removeItem("allBoothRequests");
        localStorage.removeItem("lastBoothRequestsFetch");
        await refresh();
    };

    // const sendEmail = async () => {
    //     try {
    //         const res = await fetch("/api/send-email", {
    //             method: "POST",
    //             headers: {
    //                 "Content-Type": "application/json",
    //             },
    //             body: JSON.stringify({
    //                 to: "795804@pdsb.net",
    //                 subject: "Automated Email",
    //                 text: "Dude please work",
    //             }),
    //         });
    //         const data = await res.text();
    //         console.log("Response:", data);
    //     } catch (err) {
    //         console.error("Error:", err);
    //     }
    // };

    useEffect(() => {
        setApproved(boothRequests.map((req) => req.status === "approved"));
    }, [boothRequests]);

    return (
        <Card className="w-full shadow-sm max-h-[600px] overflow-y-auto">
            <CardHeader>
                <CardTitle>Booth Requests</CardTitle>
                <CardDescription>All pending booth requests.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="w-full h-full flex flex-col gap-y-2">
                    <div className="flex justify-between">
                        <div className="w-full flex justify-start gap-x-2">
                            <button
                                onClick={() => setSelectedFilter("all")}
                                style={{
                                    color:
                                        selectedFilter === "all"
                                            ? "white"
                                            : "black",
                                    backgroundColor:
                                        selectedFilter === "all"
                                            ? "black"
                                            : "white",
                                }}
                                className="font-bold p-2 border-2 border-white hover:border-black rounded-lg transition-all duration-200"
                            >
                                All
                            </button>
                            <button
                                onClick={() => setSelectedFilter("pending")}
                                style={{
                                    color:
                                        selectedFilter === "pending"
                                            ? "white"
                                            : "black",
                                    backgroundColor:
                                        selectedFilter === "pending"
                                            ? "#CA8A04"
                                            : "white",
                                }}
                                className="font-bold p-2 border-2 border-white hover:border-yellow-600 rounded-lg transition-all duration-200"
                            >
                                Pending
                            </button>
                            <button
                                onClick={() => setSelectedFilter("approved")}
                                style={{
                                    color:
                                        selectedFilter === "approved"
                                            ? "white"
                                            : "black",
                                    backgroundColor:
                                        selectedFilter === "approved"
                                            ? "#33A349"
                                            : "white",
                                }}
                                className="font-bold p-2 border-2 border-white hover:border-green-600 rounded-lg transition-all duration-200"
                            >
                                Approved
                            </button>
                        </div>
                        <button
                            className="rounded-lg hover:bg-gray-300 px-2"
                            onClick={async () => await refreshBoothRequests()}
                        >
                            <RefreshCcw />
                        </button>
                    </div>
                    {/* <button onClick={() => sendEmail()}>Click to send email</button> */}
                    {boothRequests.length > 0
                        ? boothRequests
                              .map((boothRequest, i) => ({ boothRequest, i }))
                              .filter(
                                  ({ i }) =>
                                      (selectedFilter === "approved" &&
                                          approved[i]) ||
                                      (selectedFilter === "pending" &&
                                          !approved[i]) ||
                                      selectedFilter === "all",
                              )
                              .map(({ boothRequest, i }) => (
                                  <Card key={i}>
                                      <div className="md:flex md:justify-between md:pr-4">
                                          <CardHeader className="md:w-2/3">
                                              <CardTitle className="flex place-items-center gap-x-4">
                                                  {boothRequest.boothName}{" "}
                                                  <div
                                                      className="w-2 h-2 rounded-full"
                                                      style={{
                                                          display:
                                                              selectedFilter ===
                                                              "all"
                                                                  ? "block"
                                                                  : "none",
                                                          backgroundColor:
                                                              approved[i]
                                                                  ? "#33A349"
                                                                  : "#CA8A04",
                                                      }}
                                                  ></div>
                                              </CardTitle>
                                              <CardDescription className="overflow-ellipsis">
                                                  {
                                                      boothRequest.boothDescription
                                                  }
                                              </CardDescription>
                                          </CardHeader>
                                          <div className="flex flex-row md:flex-col justify-evenly place-items-end text-sm">
                                              <button
                                                  disabled={approveLoading[i]}
                                                  onClick={() =>
                                                      handleClickApprove(i)
                                                  }
                                                  style={{
                                                      display: approved[i]
                                                          ? "none"
                                                          : "flex",
                                                      cursor: approveLoading[i]
                                                          ? "wait"
                                                          : "pointer",
                                                  }}
                                                  className="hover:text-green-500 flex place-items-center flex-col md:flex-row p-1"
                                              >
                                                  {displayApproveConfirmation[
                                                      i
                                                  ] && (
                                                      <div className="font-bold">
                                                          Are you sure?{" "}
                                                      </div>
                                                  )}
                                                  <Check />
                                              </button>
                                              <button
                                                  onClick={() =>
                                                      handleClickInspect(i)
                                                  }
                                                  className="hover:text-gray-400 p-1"
                                              >
                                                  <ScanEye />
                                              </button>
                                          </div>
                                      </div>
                                      {/* INSPECTION MODAL */}
                                      <div
                                          className={`fixed z-10 inset-0 flex justify-center items-center p-2 ${activeInspectModal === i ? "pointer-events-auto" : "pointer-events-none"} max-h-screen overflow-y-auto`}
                                      >
                                          <div
                                              className={`absolute inset-0 bg-black/80 transition-opacity duration-500 ease-in-out ${activeInspectModal === i ? "opacity-100" : "opacity-0"}`}
                                          />
                                          <div
                                              className={`relative bg-white rounded-xl text-black p-4 w-full max-w-[600px] transition-all duration-500 ease-in-out
                                                        ${
                                                            activeInspectModal ===
                                                            i
                                                                ? "opacity-100 scale-100 translate-y-0"
                                                                : "opacity-0 scale-95 translate-y-4"
                                                        }`}
                                          >
                                              <div className="flex justify-between items-center">
                                                  <div className="font-semibold">
                                                      Inspecting booth "
                                                      {boothRequest.boothName}"
                                                  </div>
                                                  <button
                                                      className="hover:text-red-500 transition-all duration-200"
                                                      onClick={() =>
                                                          setActiveInspectModal(
                                                              -1,
                                                          )
                                                      }
                                                  >
                                                      <X />
                                                  </button>
                                              </div>
                                              <div className="text-sm flex flex-col place-items-start gap-y-2 pt-4 border-t-2 border-t-gray-500">
                                                  <div>
                                                      <b>Booth name: </b>
                                                      {boothRequest.boothName}
                                                  </div>
                                                  <div>
                                                      <b>Booth description: </b>
                                                      {
                                                          boothRequest.boothDescription
                                                      }
                                                  </div>
                                                  <div>
                                                      <b>Group Type: </b>
                                                      {boothRequest.groupType}
                                                  </div>
                                                  <div>
                                                      <b>Group Info: </b>
                                                      {boothRequest.groupInfo}
                                                  </div>

                                                  <div className="text-base font-bold">
                                                      Teachers
                                                  </div>
                                                  <ul className="pl-4 list-disc">
                                                      {boothRequest.teachers.map(
                                                          (teacher, i) => (
                                                              <li key={i}>
                                                                  {teacher.name}{" "}
                                                                  |{" "}
                                                                  {
                                                                      teacher.email
                                                                  }
                                                              </li>
                                                          ),
                                                      )}
                                                  </ul>

                                                  <div className="text-base font-bold">
                                                      Dates Running:
                                                  </div>
                                                  <ul className="pl-4 list-disc">
                                                      {boothRequest.sellingDates
                                                          ? boothRequest.sellingDates.map(
                                                                (
                                                                    isSellingToday,
                                                                    i,
                                                                ) =>
                                                                    isSellingToday && (
                                                                        <li
                                                                            key={
                                                                                i
                                                                            }
                                                                        >
                                                                            {
                                                                                CHARITY_WEEK_DATES[
                                                                                    i
                                                                                ]
                                                                            }
                                                                        </li>
                                                                    ),
                                                            )
                                                          : ""}
                                                  </ul>

                                                  <div className="text-base font-bold">
                                                      Products
                                                  </div>
                                                  <ul className="pl-4 list-disc">
                                                      {boothRequest.products.map(
                                                          (product, i) => (
                                                              <li key={i}>
                                                                  {product.name}{" "}
                                                                  | $
                                                                  {(
                                                                      product.price /
                                                                      100
                                                                  ).toFixed(2)}
                                                              </li>
                                                          ),
                                                      )}
                                                  </ul>
                                                  <div className="text-sm">
                                                      Additional Information:{" "}
                                                      {boothRequest.additionalInformation ||
                                                          "None provided"}
                                                  </div>
                                              </div>
                                          </div>
                                      </div>
                                      {/* APPROVAL MODAL */}
                                      <div
                                          className={`fixed z-10 inset-0 flex justify-center items-center p-2 ${activeApproveModal === i ? "pointer-events-auto" : "pointer-events-none"} max-h-screen overflow-y-auto`}
                                      >
                                          <div
                                              className={`absolute inset-0 bg-black/80 transition-opacity duration-500 ease-in-out ${activeApproveModal === i ? "opacity-100" : "opacity-0"}`}
                                          />
                                          <div
                                              className={`relative bg-white rounded-xl text-black p-4 w-full max-w-[600px] transition-all duration-500 ease-in-out
                                                        ${
                                                            activeApproveModal ===
                                                            i
                                                                ? "opacity-100 scale-100 translate-y-0"
                                                                : "opacity-0 scale-95 translate-y-4"
                                                        }`}
                                          >
                                              <div className="flex justify-between items-center">
                                                  <div className="font-semibold">
                                                      Approving booth "
                                                      {boothRequest.boothName}"
                                                  </div>
                                                  <button
                                                      className="hover:text-red-500 transition-all duration-200"
                                                      style={{
                                                          display:
                                                              approveLoading[i]
                                                                  ? "hidden"
                                                                  : "block",
                                                      }}
                                                      onClick={() =>
                                                          handleCloseApproveModal()
                                                      }
                                                  >
                                                      <X />
                                                  </button>
                                              </div>
                                              <div className="text-sm flex flex-col place-items-start gap-y-2 pt-4 border-t-2 border-t-gray-500">
                                                  <div className="">
                                                      {isAllGood ? (
                                                          <div>
                                                              Everything went
                                                              well
                                                          </div>
                                                      ) : (
                                                          <div></div>
                                                      )}
                                                      {foundUniquePIN ? (
                                                          <div>
                                                              <b>
                                                                  Unique PIN
                                                                  found ✅:{" "}
                                                              </b>
                                                              {PIN}
                                                          </div>
                                                      ) : (
                                                          <div>
                                                              No unique PIN
                                                              found ❌.
                                                          </div>
                                                      )}
                                                  </div>
                                                  <div className="text-base font-bold">
                                                      Teachers
                                                  </div>
                                                  <ul className="pl-4 list-disc">
                                                      {boothRequest.teachers.map(
                                                          (teacher, i) => (
                                                              <li key={i}>
                                                                  {teacher.name}{" "}
                                                                  |{" "}
                                                                  {
                                                                      teacher.email
                                                                  }{" "}
                                                                  | ✅
                                                              </li>
                                                          ),
                                                      )}
                                                  </ul>
                                                  <div className="text-base font-bold">
                                                      Products
                                                  </div>
                                                  <ul className="pl-4 list-disc">
                                                      {boothRequest.products.map(
                                                          (product, i) => (
                                                              <li key={i}>
                                                                  {product.name}{" "}
                                                                  | $
                                                                  {(
                                                                      product.price /
                                                                      100
                                                                  ).toFixed(2)}
                                                              </li>
                                                          ),
                                                      )}
                                                  </ul>
                                              </div>
                                          </div>
                                      </div>
                                  </Card>
                              ))
                        : "There are currently no pending booth requests."}
                </div>
            </CardContent>
        </Card>
    );
};

export default BoothRequestsList;
