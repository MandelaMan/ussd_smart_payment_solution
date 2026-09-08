const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  isZohoEmail,
  isZohoPrimaryContactPerson,
  pickPrimaryZohoContactPerson,
  buildZohoContactPersonsPayload,
  invoiceEmailContactPersonIds,
  buildInvoiceEmailContactPersonsPayload,
  invoiceAlreadyHasEmailContactPersons,
  isOpenReminderInvoice,
} = require("../../api/utils/zohoContactPersons");

describe("zohoContactPersons", () => {
  it("treats Zoho primary flags without Boolean('false') pitfall", () => {
    assert.equal(isZohoPrimaryContactPerson(true), true);
    assert.equal(isZohoPrimaryContactPerson("true"), true);
    assert.equal(isZohoPrimaryContactPerson("false"), false);
    assert.equal(isZohoPrimaryContactPerson(false), false);
  });

  it("picks the primary contact person, else the first", () => {
    const contact = {
      contact_persons: [
        { contact_person_id: "1", is_primary_contact: false, email: "a@x.com" },
        { contact_person_id: "2", is_primary_contact: true, email: "b@x.com" },
      ],
    };
    assert.equal(pickPrimaryZohoContactPerson(contact).contact_person_id, "2");
    assert.equal(
      pickPrimaryZohoContactPerson({
        contact_persons: [{ contact_person_id: "9" }],
      }).contact_person_id,
      "9"
    );
  });

  it("preserves non-primary persons and copies email onto the primary", () => {
    const existing = {
      contact_persons: [
        {
          contact_person_id: "p1",
          is_primary_contact: true,
          first_name: "Roman",
          email: "old@x.com",
        },
        {
          contact_person_id: "p2",
          is_primary_contact: false,
          first_name: "CC",
          email: "cc@x.com",
        },
      ],
    };
    const payload = buildZohoContactPersonsPayload(existing, {
      first_name: "Roman",
      last_name: "Sinfelt",
      email: "roman@x.com",
    });
    assert.equal(payload.length, 2);
    assert.equal(payload[0].contact_person_id, "p1");
    assert.equal(payload[0].email, "roman@x.com");
    assert.equal(payload[0].is_primary_contact, true);
    assert.equal(payload[1].contact_person_id, "p2");
    assert.equal(payload[1].email, "cc@x.com");
    assert.equal("is_primary_contact" in payload[1], false);
  });

  it("only associates contact persons that have an email", () => {
    const contact = {
      email: "roman@x.com",
      contact_persons: [
        {
          contact_person_id: "p1",
          is_primary_contact: true,
          email: "roman@x.com",
        },
        { contact_person_id: "p2", email: "" },
        { contact_person_id: "p3", email: "cc@x.com" },
      ],
    };
    assert.deepEqual(invoiceEmailContactPersonIds(contact), ["p1", "p3"]);
    assert.deepEqual(
      invoiceEmailContactPersonIds({
        email: "roman@x.com",
        contact_persons: [{ contact_person_id: "p1", first_name: "Roman" }],
      }),
      []
    );
  });

  it("builds invoice payload with email communications enabled", () => {
    const payload = buildInvoiceEmailContactPersonsPayload(["p1", "p1", ""]);
    assert.deepEqual(payload.contact_persons, ["p1"]);
    assert.deepEqual(payload.contact_persons_associated, [
      {
        contact_person_id: "p1",
        communication_preference: { is_email_enabled: true },
      },
    ]);
    assert.equal(buildInvoiceEmailContactPersonsPayload([]), null);
  });

  it("detects invoices that still need a contact-person email association", () => {
    assert.equal(
      invoiceAlreadyHasEmailContactPersons({ contact_persons: [] }, ["p1"]),
      false
    );
    assert.equal(
      invoiceAlreadyHasEmailContactPersons(
        {
          contact_persons_associated: [
            {
              contact_person_id: "p1",
              contact_person_email: "roman@x.com",
              communication_preference: { is_email_enabled: true },
            },
          ],
        },
        ["p1"]
      ),
      true
    );
    assert.equal(
      invoiceAlreadyHasEmailContactPersons(
        {
          contact_persons_associated: [
            {
              contact_person_id: "p1",
              communication_preference: { is_email_enabled: true },
            },
          ],
        },
        ["p1"]
      ),
      false
    );
  });

  it("treats unpaid / overdue invoices as reminder candidates", () => {
    assert.equal(
      isOpenReminderInvoice({ invoice_id: "1", status: "overdue", balance: 500 }),
      true
    );
    assert.equal(
      isOpenReminderInvoice({ invoice_id: "1", status: "paid", balance: 0 }),
      false
    );
    assert.equal(isZohoEmail("roman@x.com"), true);
    assert.equal(isZohoEmail(""), false);
  });
});
