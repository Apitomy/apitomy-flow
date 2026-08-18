package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * End-to-end test of the workflow engine using a Loan Approval scenario.
 * Exercises real data inputs, multiple action executors with business logic,
 * human task completion, event correlation via a receive-event node, and
 * data flowing through the entire workflow lifecycle.
 */
class LoanApprovalEndToEndTest {

    private NodeExecutor creditCheckExecutor;
    private NodeExecutor disburseLoanExecutor;
    private NodeExecutor sendRejectionExecutor;
    private WorkflowEngine engine;

    @BeforeEach
    void setUp() {
        creditCheckExecutor = new NodeExecutor() {
            public String actionType() { return "credit-check"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                Number loanAmount = (Number) ctx.workflowContext().get("loanAmount");
                Number annualIncome = (Number) ctx.workflowContext().get("annualIncome");
                double ratio = annualIncome.doubleValue() / loanAmount.doubleValue();
                int creditScore = (int) Math.min(ratio * 100, 850);
                double dti = loanAmount.doubleValue() / annualIncome.doubleValue();
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of(
                    "creditScore", creditScore,
                    "debtToIncomeRatio", Math.round(dti * 100.0) / 100.0
                ));
            }
        };

        disburseLoanExecutor = new NodeExecutor() {
            public String actionType() { return "disburse-loan"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                String applicant = (String) ctx.workflowContext().get("applicantName");
                Number amount = (Number) ctx.workflowContext().get("loanAmount");
                String fundingRef = (String) ctx.workflowContext().get("fundingReference");
                String confirmation = "Disbursed $" + amount + " to " + applicant + " via " + fundingRef;
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of(
                    "disbursementConfirmation", confirmation
                ));
            }
        };

        sendRejectionExecutor = new NodeExecutor() {
            public String actionType() { return "send-rejection"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                String applicant = (String) ctx.workflowContext().get("applicantName");
                int creditScore = (int) ctx.workflowContext().get("creditScore");
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of(
                    "rejectionReason", applicant + " denied: credit score " + creditScore + " below threshold"
                ));
            }
        };

        engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(creditCheckExecutor, disburseLoanExecutor, sendRejectionExecutor),
            List.of(), null);
    }

    private Workflow loanApprovalWorkflow() {
        return new Workflow("loan-wf", "Loan Approval", null,
            List.of(
                startNode("start", List.of(
                    inputDef("applicantName", "string", true),
                    inputDef("loanAmount", "number", true),
                    inputDef("annualIncome", "number", true)
                )),
                actionNode("credit-check", "credit-check"),
                humanTaskNode("manual-review",
                    "Review the applicant's credit data and approve or reject the loan.",
                    Map.of(
                        "Applicant", "context.applicantName",
                        "Loan Amount", "context.loanAmount",
                        "Credit Score", "context.creditScore",
                        "Debt-to-Income Ratio", "context.debtToIncomeRatio"
                    ),
                    List.of(
                        inputDef("approved", "boolean", true),
                        inputDef("reviewNotes", "string", false),
                        inputDef("loanId", "string", false)
                    )
                ),
                receiveEventNode("await-funding", "funding-confirmed", List.of(
                    "event.loanId == context.loanId"
                )),
                actionNode("disburse-loan", "disburse-loan"),
                actionNode("send-rejection", "send-rejection"),
                endNode("approved"),
                endNode("rejected")
            ),
            List.of(
                edge("e1", "start", "credit-check"),
                edge("e2", "credit-check", "manual-review"),
                edge("e3", "manual-review", "await-funding", "context.approved == true", 1),
                defaultEdge("e4", "manual-review", "send-rejection"),
                edge("e5", "await-funding", "disburse-loan"),
                edge("e6", "disburse-loan", "approved"),
                edge("e7", "send-rejection", "rejected")
            ));
    }

    @Test
    void loanApproved() {
        Workflow workflow = loanApprovalWorkflow();
        Map<String, Object> inputs = Map.of(
            "applicantName", "Alice Johnson",
            "loanAmount", 50000,
            "annualIncome", 120000
        );

        // Start workflow — runs credit check, then pauses at manual review
        WorkflowInstance instance = engine.startWorkflow(workflow, inputs);
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("manual-review", instance.currentNodeId());

        // Verify credit check ran using real input data
        assertEquals(240, instance.context().get("creditScore"));
        assertEquals(0.42, instance.context().get("debtToIncomeRatio"));

        // Simulate loan officer approving the loan and assigning a loan ID
        NodeResult reviewResult = new NodeResult(NodeResultStatus.COMPLETED, Map.of(
            "approved", true,
            "reviewNotes", "Good income-to-loan ratio, approved for standard terms",
            "loanId", "LOAN-2026-0042"
        ));
        instance = engine.completeCurrentNode(workflow, instance, reviewResult);

        // Should now be waiting at the receive-event node for funding confirmation
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("await-funding", instance.currentNodeId());
        assertTrue((Boolean) instance.context().get("approved"));
        assertEquals("LOAN-2026-0042", instance.context().get("loanId"));

        // Send a funding event that does NOT match (wrong loanId)
        Map<String, Object> wrongEvent = Map.of(
            "type", "funding-confirmed",
            "loanId", "LOAN-OTHER",
            "fundingReference", "WIRE-99999"
        );
        assertFalse(engine.matchesEvent(workflow, instance, wrongEvent));

        // Send the correct funding event
        Map<String, Object> fundingEvent = Map.of(
            "type", "funding-confirmed",
            "loanId", "LOAN-2026-0042",
            "fundingReference", "WIRE-12345"
        );
        assertTrue(engine.matchesEvent(workflow, instance, fundingEvent));

        // Complete the receive-event node with the event payload
        instance = engine.completeCurrentNode(workflow, instance,
            new NodeResult(NodeResultStatus.COMPLETED, fundingEvent));

        // Workflow should have run disburse-loan and completed
        assertEquals(InstanceStatus.COMPLETED, instance.status());
        assertEquals("approved", instance.currentNodeId());

        // Verify the disburse action used data from inputs, human task, AND the event
        String confirmation = (String) instance.context().get("disbursementConfirmation");
        assertNotNull(confirmation);
        assertTrue(confirmation.contains("Alice Johnson"), "Should reference applicant from start inputs");
        assertTrue(confirmation.contains("50000"), "Should reference loan amount from start inputs");
        assertTrue(confirmation.contains("WIRE-12345"), "Should reference funding ref from receive event");

        // Verify full context accumulated through the workflow
        assertEquals("Alice Johnson", instance.context().get("applicantName"));
        assertEquals("Good income-to-loan ratio, approved for standard terms",
            instance.context().get("reviewNotes"));
    }

    @Test
    void loanRejected() {
        Workflow workflow = loanApprovalWorkflow();
        Map<String, Object> inputs = Map.of(
            "applicantName", "Bob Smith",
            "loanAmount", 200000,
            "annualIncome", 45000
        );

        // Start workflow — runs credit check, pauses at manual review
        WorkflowInstance instance = engine.startWorkflow(workflow, inputs);
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("manual-review", instance.currentNodeId());

        // Verify credit check computed a low score from the unfavorable ratio
        assertEquals(22, instance.context().get("creditScore"));
        assertEquals(4.44, instance.context().get("debtToIncomeRatio"));

        // Simulate loan officer rejecting the loan
        NodeResult reviewResult = new NodeResult(NodeResultStatus.COMPLETED, Map.of(
            "approved", false,
            "reviewNotes", "Debt-to-income ratio too high"
        ));
        instance = engine.completeCurrentNode(workflow, instance, reviewResult);

        // Should have taken the default edge to send-rejection and completed
        assertEquals(InstanceStatus.COMPLETED, instance.status());
        assertEquals("rejected", instance.currentNodeId());

        // Verify rejection action used data from both start inputs and credit check
        String reason = (String) instance.context().get("rejectionReason");
        assertNotNull(reason);
        assertTrue(reason.contains("Bob Smith"), "Should reference applicant from start inputs");
        assertTrue(reason.contains("22"), "Should reference credit score from credit-check action");

        // Verify the receive-event and disburse nodes were never reached
        boolean reachedFunding = instance.history().stream()
            .anyMatch(h -> h.nodeId().equals("await-funding"));
        boolean reachedDisburse = instance.history().stream()
            .anyMatch(h -> h.nodeId().equals("disburse-loan"));
        assertFalse(reachedFunding, "Should not reach funding node on rejection path");
        assertFalse(reachedDisburse, "Should not reach disburse node on rejection path");
    }

    @Test
    void missingRequiredInputThrows() {
        Workflow workflow = loanApprovalWorkflow();
        assertThrows(IllegalArgumentException.class, () ->
            engine.startWorkflow(workflow, Map.of("applicantName", "Test")));
    }
}
