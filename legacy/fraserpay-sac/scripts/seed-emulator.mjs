import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-fraserpay";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8180";
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9199";

if (
  projectId !== "demo-fraserpay" ||
  firestoreEmulatorHost !== "127.0.0.1:8180" ||
  authEmulatorHost !== "127.0.0.1:9199"
) {
  throw new Error(
    "Refusing to seed: this script only permits demo-fraserpay on Auth 9199 and Firestore 8180.",
  );
}

process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulatorHost;
process.env.FIREBASE_AUTH_EMULATOR_HOST = authEmulatorHost;

const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const now = Date.now();
const iso = (offsetMs = 0) => new Date(now - offsetMs).toISOString();
const password = "Password123!";

const users = [
  {
    uid: "legacy-student-001",
    email: "p100001@pdsb.net",
    name: "Avery Chen",
    studentNumber: "P100001",
    role: "student",
    tickets: 12700,
    points: 215,
    boothAccess: ["legacy-booth-campus-cafe", "legacy-booth-spirit-shop"],
  },
  {
    uid: "legacy-student-002",
    email: "p100002@pdsb.net",
    name: "Jordan Patel",
    studentNumber: "P100002",
    role: "student",
    tickets: 8450,
    points: 340,
    boothAccess: ["legacy-booth-spirit-shop"],
  },
  {
    uid: "legacy-booth-manager",
    email: "p100003@pdsb.net",
    name: "Morgan Rivera",
    studentNumber: "P100003",
    role: "student",
    tickets: 5000,
    points: 80,
    boothAccess: [
      "legacy-booth-campus-cafe",
      "legacy-booth-spirit-shop",
      "legacy-booth-art-studio",
    ],
  },
  {
    uid: "legacy-sac-admin",
    email: "909957@pdsb.net",
    name: "Taylor Williams",
    studentNumber: "909957",
    role: "sac",
    tickets: 10000,
    points: 500,
    boothAccess: [],
  },
  {
    uid: "legacy-sac-admin-demo",
    email: "sacadmin@pdsb.net",
    name: "Demo SAC Administrator",
    studentNumber: "SACADMIN",
    role: "sac",
    password: "SACAdmin123!",
    tickets: 10000,
    points: 1000,
    boothAccess: [],
  },
];

const productsByBooth = {
  "legacy-booth-campus-cafe": [
    { id: "legacy-product-iced-coffee", name: "Iced Coffee", price: 450, salesCount: 12 },
    { id: "legacy-product-granola-bar", name: "Granola Bar", price: 250, salesCount: 8 },
    { id: "legacy-product-fruit-cup", name: "Fruit Cup", price: 350, salesCount: 6 },
  ],
  "legacy-booth-spirit-shop": [
    { id: "legacy-product-spirit-shirt", name: "Spirit T-Shirt", price: 1800, salesCount: 9 },
    { id: "legacy-product-sticker-pack", name: "Sticker Pack", price: 300, salesCount: 18 },
    { id: "legacy-product-school-hoodie", name: "School Hoodie", price: 4200, salesCount: 4 },
  ],
  "legacy-booth-art-studio": [
    { id: "legacy-product-custom-print", name: "Custom Print", price: 300, salesCount: 0 },
  ],
};

const boothSpecs = [
  {
    id: "legacy-booth-campus-cafe",
    name: "Campus Café",
    description: "Coffee, snacks, and quick lunches between classes.",
    pin: "2468",
    members: ["legacy-booth-manager", "legacy-student-001"],
    sales: 4050,
    createdOffset: 7 * 24 * 60 * 60 * 1000,
  },
  {
    id: "legacy-booth-spirit-shop",
    name: "Spirit Shop",
    description: "Fraser spirit wear and small school keepsakes.",
    pin: "1357",
    members: ["legacy-booth-manager", "legacy-student-001", "legacy-student-002"],
    sales: 10500,
    createdOffset: 6 * 24 * 60 * 60 * 1000,
  },
  {
    id: "legacy-booth-art-studio",
    name: "Art Studio",
    description: "Student-made prints and custom artwork.",
    pin: "8642",
    members: ["legacy-booth-manager"],
    sales: 0,
    createdOffset: 5 * 24 * 60 * 60 * 1000,
  },
];

const purchases = [
  {
    id: "legacy-transaction-001",
    studentId: "legacy-student-001",
    studentName: "Avery Chen",
    boothId: "legacy-booth-campus-cafe",
    boothName: "Campus Café",
    sellerId: "legacy-booth-manager",
    sellerName: "Morgan Rivera",
    amount: 800,
    products: [
      { productId: "legacy-product-iced-coffee", productName: "Iced Coffee", quantity: 1, price: 450 },
      { productId: "legacy-product-fruit-cup", productName: "Fruit Cup", quantity: 1, price: 350 },
    ],
    createdOffset: 3 * 60 * 60 * 1000,
  },
  {
    id: "legacy-transaction-002",
    studentId: "legacy-student-002",
    studentName: "Jordan Patel",
    boothId: "legacy-booth-campus-cafe",
    boothName: "Campus Café",
    sellerId: "legacy-booth-manager",
    sellerName: "Morgan Rivera",
    amount: 1150,
    products: [
      { productId: "legacy-product-iced-coffee", productName: "Iced Coffee", quantity: 2, price: 450 },
      { productId: "legacy-product-granola-bar", productName: "Granola Bar", quantity: 1, price: 250 },
    ],
    createdOffset: 8 * 60 * 60 * 1000,
  },
  {
    id: "legacy-transaction-003",
    studentId: "legacy-student-001",
    studentName: "Avery Chen",
    boothId: "legacy-booth-campus-cafe",
    boothName: "Campus Café",
    sellerId: "legacy-booth-manager",
    sellerName: "Morgan Rivera",
    amount: 2100,
    products: [
      { productId: "legacy-product-iced-coffee", productName: "Iced Coffee", quantity: 2, price: 450 },
      { productId: "legacy-product-granola-bar", productName: "Granola Bar", quantity: 2, price: 250 },
      { productId: "legacy-product-fruit-cup", productName: "Fruit Cup", quantity: 2, price: 350 },
    ],
    createdOffset: 26 * 60 * 60 * 1000,
  },
  {
    id: "legacy-transaction-004",
    studentId: "legacy-student-002",
    studentName: "Jordan Patel",
    boothId: "legacy-booth-spirit-shop",
    boothName: "Spirit Shop",
    sellerId: "legacy-booth-manager",
    sellerName: "Morgan Rivera",
    amount: 1800,
    products: [
      { productId: "legacy-product-spirit-shirt", productName: "Spirit T-Shirt", quantity: 1, price: 1800 },
    ],
    createdOffset: 30 * 60 * 60 * 1000,
  },
  {
    id: "legacy-transaction-005",
    studentId: "legacy-student-001",
    studentName: "Avery Chen",
    boothId: "legacy-booth-spirit-shop",
    boothName: "Spirit Shop",
    sellerId: "legacy-booth-manager",
    sellerName: "Morgan Rivera",
    amount: 4200,
    products: [
      { productId: "legacy-product-school-hoodie", productName: "School Hoodie", quantity: 1, price: 4200 },
    ],
    createdOffset: 2 * 24 * 60 * 60 * 1000,
  },
  {
    id: "legacy-transaction-006",
    studentId: "legacy-student-002",
    studentName: "Jordan Patel",
    boothId: "legacy-booth-spirit-shop",
    boothName: "Spirit Shop",
    sellerId: "legacy-booth-manager",
    sellerName: "Morgan Rivera",
    amount: 4500,
    products: [
      { productId: "legacy-product-school-hoodie", productName: "School Hoodie", quantity: 1, price: 4200 },
      { productId: "legacy-product-sticker-pack", productName: "Sticker Pack", quantity: 1, price: 300 },
    ],
    createdOffset: 3 * 24 * 60 * 60 * 1000,
  },
];

const upsertAuthUser = async (user) => {
  const userPassword = user.password ?? password;

  try {
    await auth.getUser(user.uid);
    await auth.updateUser(user.uid, {
      email: user.email,
      password: userPassword,
      displayName: user.name,
      disabled: false,
    });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      password: userPassword,
      displayName: user.name,
    });
  }

  await auth.setCustomUserClaims(user.uid, { role: user.role });
};

const seed = async () => {
  for (const user of users) {
    await upsertAuthUser(user);
  }

  const batch = db.batch();

  for (const user of users) {
    batch.set(db.collection("users").doc(user.uid), {
      id: user.uid,
      uid: user.uid,
      name: user.name,
      email: user.email,
      student_number: user.studentNumber,
      role: user.role,
      tickets: user.tickets,
      points: user.points,
      booth_access: user.boothAccess,
      qr_code: `USER:${user.uid}`,
      created_at: iso(10 * 24 * 60 * 60 * 1000),
    });
  }

  for (const booth of boothSpecs) {
    const embeddedProducts = productsByBooth[booth.id].map((product) => ({
      ...product,
      boothId: booth.id,
      booth_id: booth.id,
      description: "Demo product for local reference",
      image: "",
    }));

    batch.set(db.collection("booths").doc(booth.id), {
      id: booth.id,
      name: booth.name,
      description: booth.description,
      pin: booth.pin,
      members: booth.members,
      managers: ["legacy-booth-manager"],
      products: embeddedProducts,
      sales: booth.sales,
      totalEarnings: booth.sales,
      created_at: iso(booth.createdOffset),
      updated_at: iso(booth.createdOffset - 60 * 60 * 1000),
      created_by: "legacy-booth-manager",
    });

    for (const product of productsByBooth[booth.id]) {
      batch.set(db.collection("products").doc(product.id), {
        id: product.id,
        name: product.name,
        price: product.price,
        booth_id: booth.id,
        description: "Demo product for local reference",
        image: "",
        created_at: iso(booth.createdOffset),
      });
    }
  }

  batch.set(db.collection("sac_authorized_users").doc("legacy-sac-admin"), {
    email: "909957@pdsb.net",
    name: "Taylor Williams",
    role: "sac",
    created_at: iso(10 * 24 * 60 * 60 * 1000),
  });

  batch.set(db.collection("sac_authorized_users").doc("legacy-sac-admin-demo"), {
    email: "sacadmin@pdsb.net",
    name: "Demo SAC Administrator",
    role: "sac",
    created_at: iso(10 * 24 * 60 * 60 * 1000),
  });

  batch.set(db.collection("sac_authorized_users").doc("legacy-sac-grass-chicken-499"), {
    email: "grass.chicken.499@pdsb.net",
    name: "Grass Chicken 499",
    role: "sac",
    created_at: iso(),
  });

  batch.set(db.collection("booth_requests").doc("legacy-request-001"), {
    teachers: [{ name: "Jamie Lee", email: "jlee@pdsb.net" }],
    products: [{ name: "Hot Chocolate", price: 2.5 }],
    boothName: "Winter Warmers",
    boothDescription: "A demo pending booth request.",
    groupType: "Student club",
    groupInfo: "Fraser Eco Club",
    sellingDates: [true, true, false, false, false, false, false],
    status: "pending",
    additionalInformation: "Seeded local-only request for SAC review screens.",
    created_at: iso(2 * 24 * 60 * 60 * 1000),
  });

  for (const transaction of purchases) {
    batch.set(db.collection("transactions").doc(transaction.id), {
      id: transaction.id,
      student_id: transaction.studentId,
      student_name: transaction.studentName,
      booth_id: transaction.boothId,
      booth_name: transaction.boothName,
      seller_id: transaction.sellerId,
      seller_name: transaction.sellerName,
      amount: transaction.amount,
      points_earned: transaction.amount / 10,
      type: "purchase",
      products: transaction.products,
      created_at: iso(transaction.createdOffset),
    });

    transaction.products.forEach((product, index) => {
      batch.set(db.collection("transaction_products").doc(`${transaction.id}-${index + 1}`), {
        transaction_id: transaction.id,
        product_id: product.productId,
        product_name: product.productName,
        quantity: product.quantity,
        price: product.price,
        created_at: iso(transaction.createdOffset),
      });
    });
  }

  batch.set(db.collection("transactions").doc("legacy-transaction-007"), {
    id: "legacy-transaction-007",
    student_id: "legacy-student-001",
    student_name: "Avery Chen",
    amount: 5000,
    type: "fund",
    sac_member: "legacy-sac-admin",
    sac_member_name: "Taylor Williams",
    created_at: iso(4 * 24 * 60 * 60 * 1000),
  });

  batch.set(db.collection("transactions").doc("legacy-transaction-008"), {
    id: "legacy-transaction-008",
    student_id: "legacy-student-001",
    student_name: "Avery Chen",
    amount: -500,
    type: "refund",
    sac_member: "legacy-sac-admin",
    sac_member_name: "Taylor Williams",
    created_at: iso(5 * 24 * 60 * 60 * 1000),
  });

  await batch.commit();

  console.log(`Seeded ${users.length} Auth users and legacy Firestore demo data in ${projectId}.`);
  console.log("Login credentials:");
  console.log("  Student: P100001");
  console.log("  Booth manager: P100003");
  console.log("  SAC admin: 909957");
  console.log("  Dedicated SAC admin: SACADMIN / SACAdmin123!");
  console.log("Booth PINs: Campus Café 2468, Spirit Shop 1357, Art Studio 8642");
};

try {
  await seed();
} finally {
  await deleteApp(app);
}
