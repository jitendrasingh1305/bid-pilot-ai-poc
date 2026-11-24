sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
  "use strict";

  const SRV = "/bid-pilot";

  return Controller.extend("bid.pilot.joule.view.Main", {

    onInit() {
      this._model = new JSONModel({
        BidRequests: [],
        HistoricalProjects: [],
        currentUser: "sales.rep@company.com",
        busy: false
      });
      this.getView().setModel(this._model);
      this._loadBids();
      this._loadHistorical();
    },

    // ─── Data loading ────────────────────────────────────────────────────

    async _loadBids() {
      try {
        const res = await fetch(`${SRV}/BidRequests?$orderby=createdAt desc&$top=20`);
        const data = await res.json();
        this._model.setProperty("/BidRequests", data.value || []);
      } catch (e) {
        console.error("Failed to load bids:", e);
      }
    },

    async _loadHistorical() {
      try {
        const res = await fetch(`${SRV}/HistoricalProjects`);
        const data = await res.json();
        this._model.setProperty("/HistoricalProjects", data.value || []);
      } catch (e) {
        console.error("Failed to load historical projects:", e);
      }
    },

    // ─── Chat interaction ────────────────────────────────────────────────

    onSendMessage() {
      const input = this.byId("chatInput");
      const text  = (input.getValue() || "").trim();
      if (!text) return;
      input.setValue("");
      this._addUserBubble(text);
      this._processMessage(text);
    },

    _processMessage(text) {
      const lower = text.toLowerCase();
      if (lower.includes("new bid") || lower.includes("create bid") || lower.includes("add bid")) {
        this._addBotBubble("Sure! Let me open a new bid form for you. Fill in the details and I'll run AI matching.");
        this.onNewBid();
      } else if (lower.includes("status") || lower.includes("open bid") || lower.includes("list")) {
        this._addBotBubble("Here are your current open bids. Select any row for details and actions.");
        this.byId("bidListPanel").setExpanded(true);
        this._loadBids();
      } else if (lower.includes("help")) {
        this._addBotBubble(
          "<b>What I can do:</b><br>" +
          "• <b>new bid</b> — start a new bid request<br>" +
          "• <b>list bids / status</b> — show open bids<br>" +
          "• Select a bid row to submit for AI, confirm match, or review sections"
        );
      } else {
        this._addBotBubble(
          "I can help you manage bids. Try:<br>" +
          "• Type <b>new bid</b> to create a request<br>" +
          "• Type <b>list bids</b> to see open requests<br>" +
          "• Select a bid row to take action"
        );
      }
    },

    _addUserBubble(text) {
      const box = this.byId("chatMessages");
      const hbox = new sap.m.HBox({ justifyContent: "End", class: "userBubbleWrap" });
      const bubble = new sap.m.VBox({ class: "userBubble" });
      bubble.addItem(new sap.m.Text({ text }));
      hbox.addItem(bubble);
      box.addItem(hbox);
      this._scrollToBottom();
    },

    _addBotBubble(html) {
      const box = this.byId("chatMessages");
      const hbox = new sap.m.HBox({ alignItems: "End", class: "botBubbleWrap" });
      const avatar = new sap.m.VBox({ class: "botAvatar" });
      avatar.addItem(new sap.m.Text({ text: "J" }));
      const bubble = new sap.m.VBox({ class: "botBubble" });
      bubble.addItem(new sap.m.FormattedText({ htmlText: html }));
      hbox.addItem(avatar);
      hbox.addItem(bubble);
      box.addItem(hbox);
      this._scrollToBottom();
    },

    _scrollToBottom() {
      const scroll = this.byId("chatScroll");
      setTimeout(() => scroll.scrollTo(0, 9999), 100);
    },

    // ─── New bid form ────────────────────────────────────────────────────

    onNewBid() {
      this.byId("newBidForm").setVisible(true);
      this.byId("chatInputRow").setVisible(false);
    },

    onCancelNewBid() {
      this._resetForm();
    },

    async onSubmitNewBid() {
      const customer  = this.byId("customerName").getValue().trim();
      const family    = this.byId("productFamily").getValue().trim();
      const reqText   = this.byId("requirementText").getValue().trim();
      const submitter = this.byId("submittedBy").getValue().trim();

      if (!customer || !family || !reqText) {
        MessageToast.show("Please fill in Customer Name, Product Family and Requirement.");
        return;
      }

      this._model.setProperty("/busy", true);
      this._addBotBubble(`Creating bid for <b>${customer}</b>...`);

      try {
        // 1. Create bid
        const createRes = await fetch(`${SRV}/BidRequests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerName: customer, productFamily: family, requirementText: reqText, submittedBy: submitter })
        });
        const bid = await createRes.json();

        this._addBotBubble(`Bid <b>${bid.bidNumber}</b> created. Sending to AI for matching...`);

        // 2. Trigger AI matching
        const matchRes = await fetch(`${SRV}/BidRequests(${bid.ID})/BidPilotService.submitForAI`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        const updated = await matchRes.json();

        this._showMatchResult(updated);
        this._resetForm();
        this._loadBids();
      } catch (e) {
        this._addBotBubble(`<span style="color:#e53935">Error: ${e.message}</span>`);
      } finally {
        this._model.setProperty("/busy", false);
      }
    },

    _showMatchResult(bid) {
      if (bid.status === "pending_match") {
        this._addBotBubble(
          `AI match found with <b>${Math.round(bid.aiMatchScore)}% confidence</b>! 🎯<br>` +
          `Bid <b>${bid.bidNumber}</b> is awaiting your confirmation.<br>` +
          `Select the bid in the table below and click <b>Confirm Match</b>.`
        );
      } else if (bid.status === "no_match_rd") {
        this._addBotBubble(
          `No historical match found for <b>${bid.bidNumber}</b>.<br>` +
          `The requirement has been routed to <b>R&D</b> for new product design.`
        );
      } else {
        this._addBotBubble(`Bid <b>${bid.bidNumber}</b> updated. Status: <b>${bid.status}</b>`);
      }
    },

    _resetForm() {
      this.byId("customerName").setValue("");
      this.byId("productFamily").setValue("");
      this.byId("requirementText").setValue("");
      this.byId("newBidForm").setVisible(false);
      this.byId("chatInputRow").setVisible(true);
    },

    // ─── Bid row actions ─────────────────────────────────────────────────

    onBidSelected(evt) {
      const ctx  = evt.getParameter("listItem").getBindingContext();
      const bid  = ctx.getObject();
      this._showBidActions(bid);
    },

    _showBidActions(bid) {
      const statusLabels = {
        received: "Received — ready to submit for AI",
        ai_processing: "AI is processing…",
        pending_match: "AI match ready — confirm or reject",
        no_match_rd: "No match — routed to R&D",
        draft_document: "Bid document drafted",
        dept_review: "Under departmental review",
        pending_corrections: "Corrections required",
        final_review: "Ready for final submission",
        submitted: "Submitted to customer"
      };

      const actions = [];
      if (bid.status === "received") actions.push({ text: "Submit for AI Matching", key: "ai" });
      if (bid.status === "pending_match") {
        actions.push({ text: "Confirm AI Match", key: "confirm" });
        actions.push({ text: "Reject Match → R&D", key: "reject" });
      }
      if (bid.status === "dept_review") {
        actions.push({ text: "Approve R&D Section", key: "approve_rd" });
        actions.push({ text: "Approve Compliance Section", key: "approve_compliance" });
        actions.push({ text: "Approve Costing Section", key: "approve_costing" });
      }
      if (bid.status === "final_review") actions.push({ text: "Submit Final Bid", key: "final" });

      let html = `<b>${bid.bidNumber}</b> — ${bid.customerName}<br>` +
                 `Status: <b>${statusLabels[bid.status] || bid.status}</b>`;
      if (bid.aiMatchScore > 0) html += `<br>AI Match Score: <b>${bid.aiMatchScore}%</b>`;

      if (actions.length > 0) {
        html += "<br><br><b>Available actions:</b><br>" +
          actions.map(a => `• <a href="javascript:void(0)" onclick="sap.ui.core.UIComponent.getRouterFor(this)">${a.text}</a>`).join("<br>");
      }
      this._addBotBubble(html);

      if (actions.length > 0) this._promptAction(bid, actions);
    },

    _promptAction(bid, actions) {
      const buttons = actions.map(a => a.text);
      MessageBox.show(
        `Bid: ${bid.bidNumber}\nCustomer: ${bid.customerName}\nStatus: ${bid.status}`,
        {
          title: "Bid Actions",
          actions: [...buttons, MessageBox.Action.CANCEL],
          emphasizedAction: buttons[0],
          onClose: async (action) => {
            const match = actions.find(a => a.text === action);
            if (!match) return;
            await this._executeBidAction(bid, match.key);
          }
        }
      );
    },

    async _executeBidAction(bid, key) {
      const base = `${SRV}/BidRequests(${bid.ID})/BidPilotService.`;
      try {
        let res, body = {};
        if (key === "ai") {
          this._addBotBubble(`Running AI matching for <b>${bid.bidNumber}</b>...`);
          res = await this._post(`${base}submitForAI`, {});
          this._showMatchResult(res);
        } else if (key === "confirm") {
          res = await this._post(`${base}confirmMatch`, {
            historicalProjectId: bid.matchedProject_ID, notes: "Confirmed by Sales"
          });
          this._addBotBubble(`Match confirmed! Bid document drafted and sent to R&D, Compliance, and Costing for review.`);
        } else if (key === "reject") {
          res = await this._post(`${base}rejectMatch`, {});
          this._addBotBubble(`Match rejected. Bid routed to R&D for new product development.`);
        } else if (key.startsWith("approve_")) {
          const dept = key.replace("approve_", "");
          res = await this._post(`${base}approveSection`, { department: dept, comments: "Approved" });
          this._addBotBubble(`${dept.toUpperCase()} section approved.`);
        } else if (key === "final") {
          res = await this._post(`${base}submitFinal`, {});
          this._addBotBubble(`Bid <b>${bid.bidNumber}</b> submitted to customer! 🎉`);
        }
        this._loadBids();
      } catch (e) {
        this._addBotBubble(`<span style="color:#e53935">Action failed: ${e.message}</span>`);
      }
    },

    async _post(url, payload) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return res.json();
    },

    onClose() {
      window.history.back();
    }
  });
});
