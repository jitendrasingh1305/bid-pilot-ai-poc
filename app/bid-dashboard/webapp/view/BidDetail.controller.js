sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
  "use strict";

  const SRV = "/bid-pilot";

  return Controller.extend("bid.pilot.dashboard.view.BidDetail", {

    onInit() {
      const router = this.getOwnerComponent().getRouter();
      router.getRoute("bidDetail").attachPatternMatched(this._onRouteMatched, this);
      this._detailModel = new JSONModel({});
      this._reviewsModel = new JSONModel([]);
      this._notifsModel  = new JSONModel([]);
      this.getView().setModel(this._detailModel, "detail");
      this.getView().setModel(this._reviewsModel, "reviews");
      this.getView().setModel(this._notifsModel, "notifs");
    },

    async _onRouteMatched(evt) {
      this._bidId = evt.getParameter("arguments").bidId;
      await this._loadBid();
    },

    async _loadBid() {
      if (!this._bidId) return;
      try {
        const [bidRes, docRes, revRes, notifRes] = await Promise.all([
          fetch(`${SRV}/BidRequests('${this._bidId}')?$expand=matchedProject`),
          fetch(`${SRV}/BidDocuments?$filter=bidRequest_ID eq '${this._bidId}'&$orderby=version desc&$top=1`),
          fetch(`${SRV}/DeptReviews?$filter=bidRequest_ID eq '${this._bidId}'&$orderby=department`),
          fetch(`${SRV}/BidNotifications?$filter=bidRequest_ID eq '${this._bidId}'&$orderby=sentAt desc`)
        ]);

        const bid   = await bidRes.json();
        const docs  = await docRes.json();
        const revs  = await revRes.json();
        const notifs = await notifRes.json();

        const doc = docs.value?.[0] || {};
        this._detailModel.setData({
          ...bid,
          bidDocId:         doc.ID,
          technicalSection: doc.technicalSection,
          complianceSection:doc.complianceSection,
          costingSection:   doc.costingSection,
          estimatedCost:    doc.estimatedCost,
          currency:         doc.currency || "INR"
        });
        this._reviewsModel.setData(revs.value || []);
        this._notifsModel.setData(notifs.value || []);
      } catch (e) {
        MessageToast.show("Failed to load bid: " + e.message);
      }
    },

    onNavBack() {
      this.getOwnerComponent().getRouter().navTo("dashboard");
    },

    // ── Actions ───────────────────────────────────────────────────────

    async onSubmitAI() {
      await this._action("submitForAI", {}, "Submitting for AI matching...");
    },

    onConfirmMatch() {
      const bid = this._detailModel.getData();
      MessageBox.confirm(
        `Confirm AI-matched project?\nMatch score: ${bid.aiMatchScore}%`,
        {
          title: "Confirm Match",
          onClose: async (action) => {
            if (action !== MessageBox.Action.OK) return;
            await this._action("confirmMatch",
              { historicalProjectId: bid.matchedProject_ID, notes: "Confirmed by Sales" },
              "Confirming match and generating bid document..."
            );
          }
        }
      );
    },

    async onRejectMatch() {
      await this._action("rejectMatch", {}, "Rejecting match, routing to R&D...");
    },

    async onSubmitFinal() {
      MessageBox.confirm("Submit final bid to customer?", {
        title: "Final Submission",
        onClose: async (action) => {
          if (action !== MessageBox.Action.OK) return;
          await this._action("submitFinal", {}, "Submitting final bid...");
        }
      });
    },

    async onApproveSection(evt) {
      const ctx  = evt.getSource().getBindingContext("reviews");
      const dept = ctx.getObject().department;
      await this._action("approveSection", { department: dept, comments: "Approved by reviewer" },
        `Approving ${dept.toUpperCase()} section...`);
    },

    async onRejectSection(evt) {
      const ctx  = evt.getSource().getBindingContext("reviews");
      const dept = ctx.getObject().department;
      MessageBox.prompt(`Reason for rejecting ${dept.toUpperCase()} section:`, {
        title: "Reject Section",
        onClose: async (action, value) => {
          if (action !== "OK") return;
          await this._action("rejectSection",
            { department: dept, comments: value || "Corrections required" },
            `Rejecting ${dept.toUpperCase()} section...`);
        }
      });
    },

    async _action(name, payload, msg) {
      MessageToast.show(msg);
      try {
        const res = await fetch(
          `${SRV}/BidRequests('${this._bidId}')/BidPilotService.${name}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
        await this._loadBid();
        MessageToast.show("Done.");
      } catch (e) {
        MessageBox.error("Action failed: " + e.message);
      }
    }
  });
});
