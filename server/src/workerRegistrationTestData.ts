import type { WorkerSubmission } from "./lib/workerRegistration.js";

export function validWorkerSubmission(): WorkerSubmission {
  return {
    submissionKey: "6f54eb62-06d8-4ea3-b3fe-e297cfe99c2a",
    email: "alex.worker@example.test",
    firstName: "Alex",
    lastName: "Worker",
    dateOfBirth: "1988-04-12",
    gender: "female",
    cellPhone: "5551234567",
    altPhone: null,
    streetAddress: "100 Camp Road",
    city: "Indianapolis",
    stateOrProvince: "IN",
    postalCode: "46201",
    country: "United States",
    faithServingResponse: "I have faithfully served the Lord for twenty years.",
    churchName: "Believers Church",
    pastorName: "Pastor Example",
    pastorPhone: "5552223333",
    taskPreferences: ["Kitchen", "Crafts", "Snack Bar"],
    tShirtSize: "M",
  };
}
