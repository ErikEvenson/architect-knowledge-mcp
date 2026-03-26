/**
 * Basic tests for the parser and search modules.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseKnowledgeFile, buildCategoryTree } from "./parser.js";
import { KnowledgeSearch } from "./search.js";

describe("parser", () => {
  it("extracts checklist items with priority tags", () => {
    const content = `# Test Provider

## Checklist

- [ ] **[Critical]** Is the network configured with redundancy?
- [ ] **[Recommended]** Are backups scheduled daily?
- [ ] **[Optional]** Is a dashboard configured for monitoring?

## Why This Matters

This section explains why the checklist matters.
`;

    const chunks = parseKnowledgeFile("providers/test/infra.md", content);

    const checklists = chunks.filter((c) => c.checklistItem !== null);
    assert.equal(checklists.length, 3);
    assert.equal(checklists[0].priority, "critical");
    assert.equal(checklists[1].priority, "recommended");
    assert.equal(checklists[2].priority, "optional");
    assert.ok(checklists[0].content.includes("network configured"));
  });

  it("extracts non-checklist sections", () => {
    const content = `# Test

## Why This Matters

Important context here about the topic.

## Common Decisions (ADR Triggers)

Decision one about architecture.
`;

    const chunks = parseKnowledgeFile("general/test.md", content);
    const sections = chunks.filter((c) => c.checklistItem === null);
    assert.ok(sections.length >= 2);
    assert.ok(sections.some((s) => s.section === "Why This Matters"));
    assert.ok(sections.some((s) => s.section === "Common Decisions (ADR Triggers)"));
  });

  it("skips See Also and Reference Links sections", () => {
    const content = `# Test

## Scope

Scope content here.

## See Also

- other/file.md

## Reference Links

- [Link](https://example.com)
`;

    const chunks = parseKnowledgeFile("general/test.md", content);
    assert.ok(!chunks.some((c) => c.section === "See Also"));
    assert.ok(!chunks.some((c) => c.section === "Reference Links"));
  });

  it("builds category tree", () => {
    const files = [
      { path: "providers/aws/containers.md" },
      { path: "providers/aws/compute.md" },
      { path: "providers/azure/compute.md" },
      { path: "compliance/hipaa.md" },
      { path: "general/networking.md" },
    ];

    const tree = buildCategoryTree(files);
    assert.deepEqual(Object.keys(tree), [
      "compliance",
      "general",
      "providers/aws",
      "providers/azure",
    ]);
    assert.equal(tree["providers/aws"].length, 2);
  });
});

describe("search", () => {
  it("finds relevant results by keyword", () => {
    const engine = new KnowledgeSearch();
    engine.buildIndex([
      {
        sourceFile: "providers/aws/containers.md",
        section: "Checklist",
        checklistItem: "Is EKS cluster configured with private endpoint?",
        priority: "critical",
        content: "Is EKS cluster configured with private endpoint?",
      },
      {
        sourceFile: "providers/azure/compute.md",
        section: "Checklist",
        checklistItem: "Are VM scale sets configured for auto-scaling?",
        priority: "recommended",
        content: "Are VM scale sets configured for auto-scaling?",
      },
      {
        sourceFile: "compliance/hipaa.md",
        section: "Why This Matters",
        checklistItem: null,
        priority: null,
        content: "HIPAA requires encryption of protected health information at rest and in transit.",
      },
    ]);

    const eksResults = engine.search("EKS private endpoint");
    assert.ok(eksResults.length > 0);
    assert.ok(eksResults[0].sourceFile.includes("aws"));

    const hipaaResults = engine.search("HIPAA encryption");
    assert.ok(hipaaResults.length > 0);
    assert.ok(hipaaResults[0].sourceFile.includes("hipaa"));
  });

  it("filters by priority", () => {
    const engine = new KnowledgeSearch();
    engine.buildIndex([
      {
        sourceFile: "general/networking.md",
        section: "Checklist",
        checklistItem: "Is DNS configured?",
        priority: "critical",
        content: "Is DNS configured with redundancy?",
      },
      {
        sourceFile: "general/networking.md",
        section: "Checklist",
        checklistItem: "Is IPv6 enabled?",
        priority: "optional",
        content: "Is IPv6 dual-stack enabled?",
      },
    ]);

    const critical = engine.search("DNS IPv6", { priorityFilter: "critical" });
    assert.ok(critical.every((r) => r.priority === "critical"));
  });

  it("filters by file path", () => {
    const engine = new KnowledgeSearch();
    engine.buildIndex([
      {
        sourceFile: "providers/aws/containers.md",
        section: "Checklist",
        checklistItem: "EKS cluster",
        priority: "critical",
        content: "EKS cluster configuration for containers",
      },
      {
        sourceFile: "providers/azure/containers.md",
        section: "Checklist",
        checklistItem: "AKS cluster",
        priority: "critical",
        content: "AKS cluster configuration for containers",
      },
    ]);

    const awsOnly = engine.search("containers cluster", { fileFilter: "aws" });
    assert.ok(awsOnly.every((r) => r.sourceFile.includes("aws")));
  });
});
