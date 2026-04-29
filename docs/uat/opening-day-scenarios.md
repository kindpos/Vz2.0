# KINDpos Vz2.0 — Opening Day UAT Sign-Off Scenarios

This document is completed by the PM and a designated staff member on opening day before going live. All 5 scenarios must pass for the system to be considered deployment-ready.

---

## Scenario 1 — Staff Login

Role: Manager

1. Power on the terminal
1. Enter manager PIN at the login screen
1. Observe screen transitions to the order-entry view

Verify: Employee name appears on shift header; staff dashboard shows shift as open.

---

## Scenario 2 — Create Order and Send to Kitchen

Role: Server

1. Select an open table
1. Create a new dine-in order
1. Add at least two food items and one drink
1. Tap "Send to Kitchen"

Verify: Kitchen ticket prints on impact printer; all items marked sent; order appears in active orders list.

---

## Scenario 3 — Cash Payment and Receipt

Role: Server

1. Open the order from Scenario 2
1. Initiate cash payment for the exact order total
1. Confirm the payment

Verify: Order status shows "closed"; thermal receipt prints with correct line items and total; day-summary cash total increases by the order amount.

---

## Scenario 4 — Card Payment with Tip Adjustment

Role: Server + Manager

1. Create a new order, add one item, send to kitchen
1. Server initiates card payment on the Dejavoo terminal
1. After approval, manager opens tip-adjust screen and enters a tip amount
1. Confirm the adjustment

Verify: Tip appears on server's shift summary; order detail shows updated tip amount on the payment record.

---

## Scenario 5 — Close Batch and Close Day

Role: Manager

1. Confirm all open orders are closed or voided
1. Record the closing cash float
1. Trigger close-batch
1. Trigger close-day

Verify: Day-summary returns correct order count, total sales, cash/card split, and tip total. Fresh order list starts clean for the next shift.

---

## Sign-Off

|Scenario             |Pass / Fail|Performed by|Time|
|---------------------|-----------|------------|----|
|1 — Staff Login      |           |            |    |
|2 — Create Order     |           |            |    |
|3 — Cash Payment     |           |            |    |
|4 — Card + Tip Adjust|           |            |    |
|5 — Close Day        |           |            |    |

**Go-live approved by:** _________________________ **Date:** _____________
