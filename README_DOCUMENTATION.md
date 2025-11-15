# Documentation Index

This directory contains comprehensive documentation about the SMPLAT CMS and component architecture, created to help you understand the existing system and build a component library.

## Documentation Files

### 1. **CMS_COMPONENT_ARCHITECTURE.md** (458 lines)
Complete technical reference of the CMS and component system.

**Contains:**
- Payload CMS v3.x configuration overview
- 9 existing marketing blocks detailed
- Component organization in apps/web
- Current patterns and approaches
- Integration point recommendations
- Key files summary with absolute paths

**Best for:** Understanding how the system works and finding specific files

---

### 2. **COMPONENT_LIBRARY_QUICKSTART.md** (295 lines)
Step-by-step guide to add new components to the system.

**Contains:**
- TL;DR overview of the data pipeline
- 5-step process to add new block types
- Component pattern examples
- Styling conventions
- Type safety strategies
- Common mistakes and debug checklist
- File locations for each task

**Best for:** Hands-on implementation and quick reference while coding

---

### 3. **ARCHITECTURE_VISUAL_REFERENCE.md** (400+ lines)
Visual diagrams and flow charts of the entire system.

**Contains:**
- System overview diagram (monorepo structure)
- 7-phase data flow visualization
- Block registration flow
- Component mapping table
- Type safety pipeline diagram
- Directory tree with critical paths marked
- Integration pattern for new components
- File naming conventions
- Quick debug checklist

**Best for:** Visual learners and understanding data flow

---

### 4. **EXPLORATION_SUMMARY.txt** (348 lines)
Executive summary of the exploration findings.

**Contains:**
- Key findings (5 main points)
- Critical files for component library
- Non-intrusive integration pattern
- Component patterns to follow
- 7-phase component workflow
- Validation system explanation
- Development workflow
- Next steps recommendations
- Risk assessment matrix

**Best for:** High-level overview and decision-making

---

## Quick Navigation

### I want to understand...

**How the system works:**
→ Start with `EXPLORATION_SUMMARY.txt` (5 min read)
→ Then read `CMS_COMPONENT_ARCHITECTURE.md` (15 min)
→ Finally view `ARCHITECTURE_VISUAL_REFERENCE.md` (10 min)

**How to add a new component:**
→ Read `COMPONENT_LIBRARY_QUICKSTART.md` (5-step guide)
→ Reference `ARCHITECTURE_VISUAL_REFERENCE.md` for file locations
→ Check examples in actual codebase

**Where specific files are:**
→ Use `CMS_COMPONENT_ARCHITECTURE.md` "Key Files Summary" table
→ Or check `ARCHITECTURE_VISUAL_REFERENCE.md` "Directory Tree"

**Why the architecture is designed this way:**
→ Read "Current Approach for Reusable Components" in `CMS_COMPONENT_ARCHITECTURE.md`
→ Read "Benefits of This Approach" in `COMPONENT_LIBRARY_QUICKSTART.md`

**What to avoid when extending:**
→ Check "High Risk" section in `EXPLORATION_SUMMARY.txt`
→ Check "Common Mistakes" in `COMPONENT_LIBRARY_QUICKSTART.md`

---

## Key Concepts

### The Block System
1. **Block Definition** (Payload CMS)
   - JSON schema editors use to create content
   - Defines field types and validation
   - Location: `apps-cms-payload/src/lexical/`

2. **React Component** (Frontend)
   - Renders the block to styled HTML
   - Props match block fields
   - Location: `apps/web/src/components/rich-text/marketing/`

3. **Converter** (Bridge)
   - Maps Payload block JSON to React props
   - Type-safe transformation
   - Location: `apps/web/src/components/rich-text/`

4. **Validation** (Guard)
   - Zod schema ensures data integrity
   - Type inference for TypeScript
   - Location: `apps/web/src/server/cms/types.ts`

### The Data Flow
```
Editor creates block → Storage in DB → Fetch via API → Validate with Zod 
→ Convert to React props → Render component → Display in browser
```

### Current Components
- 9 Payload blocks defined
- 10 React components implemented
- All use Tailwind CSS (dark theme)
- All strongly typed with TypeScript
- Non-intrusive extension pattern ready

---

## Files in the Repository

### Documentation Created
```
smplat/
├── CMS_COMPONENT_ARCHITECTURE.md          (458 lines)
├── COMPONENT_LIBRARY_QUICKSTART.md        (295 lines)
├── ARCHITECTURE_VISUAL_REFERENCE.md       (400+ lines)
├── EXPLORATION_SUMMARY.txt                (348 lines)
└── README_DOCUMENTATION.md               (this file)
```

### Critical Source Files
```
apps-cms-payload/src/
├── payload.config.ts                      ← Main CMS config
├── lexical/marketing.ts                   ← Block definitions (9 blocks)
└── collections/Pages.ts                   ← Page collection schema

apps/web/src/
├── components/rich-text/
│   ├── marketing-converters.tsx           ← Block→React mapping
│   └── marketing/                         ← React components (10 files)
├── components/marketing/
│   └── sections.tsx                       ← Orchestrator
└── server/cms/types.ts                    ← Zod validation schemas
```

---

## Integration Pattern (Non-Intrusive)

To add new components WITHOUT breaking existing code:

### Files to Create (4 new files)
1. `apps-cms-payload/src/lexical/customBlocks.ts` - Block definitions
2. `apps/web/src/components/rich-text/custom-converters.tsx` - Converters
3. `apps/web/src/components/rich-text/marketing/my-component.tsx` - Component
4. `apps/web/src/server/cms/custom-types.ts` - Zod validation

### Files to Edit (2 minimal edits)
1. `apps-cms-payload/src/payload.config.ts` - Register blocks
2. `apps/web/src/components/rich-text/rich-text.tsx` - Add converters (optional)

**Result:** 4 new files + 2 edits = fully extensible, non-breaking changes

---

## Development Workflow

1. **Start CMS**
   ```bash
   cd apps-cms-payload && npm run dev
   # Access admin at http://localhost:3050/admin
   ```

2. **Start Web**
   ```bash
   cd apps/web && npm run dev
   # View at http://localhost:3000
   ```

3. **Create Block**
   - Add to `customBlocks.ts`
   - Register in `payload.config.ts`

4. **Create Component**
   - Add to `marketing/my-component.tsx`
   - Add Tailwind styling
   - Export types

5. **Create Converter**
   - Add to `custom-converters.tsx`
   - Map block fields to component props

6. **Add Validation**
   - Add to `custom-types.ts`
   - Define Zod schema matching component props

7. **Test**
   - Edit page in Payload admin
   - Select your block
   - Fill fields and publish
   - See component render at `localhost:3000`

---

## Recommended Reading Order

### For Project Owners / Managers
1. `EXPLORATION_SUMMARY.txt` - 5 min overview
2. `COMPONENT_LIBRARY_QUICKSTART.md` - "Next Steps" section
3. Understand: 4 new files + 2 edits = non-intrusive

### For Frontend Developers
1. `COMPONENT_LIBRARY_QUICKSTART.md` - Full read (10 min)
2. `ARCHITECTURE_VISUAL_REFERENCE.md` - Study diagrams (10 min)
3. Look at example: `/apps/web/src/components/rich-text/marketing/hero-callout.tsx`
4. Look at block def: Line 3-43 of `/apps-cms-payload/src/lexical/marketing.ts`
5. Ready to implement!

### For CMS Administrators
1. `ARCHITECTURE_VISUAL_REFERENCE.md` - "Data Flow" section
2. `COMPONENT_LIBRARY_QUICKSTART.md` - "Testing Your Component" section
3. Understand: blocks are registered in CMS config, not in the admin UI

### For Designers
1. `COMPONENT_LIBRARY_QUICKSTART.md` - "Component Patterns to Follow" section
2. `ARCHITECTURE_VISUAL_REFERENCE.md` - "Component Mapping" section
3. Study existing components at `/apps/web/src/components/rich-text/marketing/`

---

## Key Statistics

- **CMS**: Payload v3.61.1 with Lexical rich text editor
- **Database**: PostgreSQL
- **Frontend**: Next.js 14.1.0
- **Styling**: Tailwind CSS (dark theme)
- **Type Safety**: TypeScript + Zod validation
- **Existing Blocks**: 9 marketing blocks
- **Existing Components**: 10 React components
- **Integration Points**: 2 files to edit for any new blocks
- **Non-Breaking**: Yes, fully extensible

---

## Absolute File Paths

All file paths in the documentation use absolute paths for clarity:

- `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/payload.config.ts`
- `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/lexical/marketing.ts`
- `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing/`
- `/Users/magnusohle/cursorprojects/smplat/apps/web/src/server/cms/types.ts`

Relative to repo root:
- `apps-cms-payload/src/payload.config.ts`
- `apps/web/src/components/rich-text/marketing/`
- `apps/web/src/server/cms/types.ts`

---

## Questions?

**How is content stored?** → See "Storage" phase in ARCHITECTURE_VISUAL_REFERENCE.md

**How does live preview work?** → See CMS_COMPONENT_ARCHITECTURE.md section 7

**What's the risk of adding new blocks?** → See EXPLORATION_SUMMARY.txt "Risk Assessment"

**Can I modify existing blocks?** → See EXPLORATION_SUMMARY.txt "Risk Assessment" (Medium Risk)

**How do I test a new component?** → See COMPONENT_LIBRARY_QUICKSTART.md "Testing Your Component"

**What are the styling conventions?** → See COMPONENT_LIBRARY_QUICKSTART.md "Component Patterns"

---

## Summary

You have a well-architected CMS system with:
- Clear separation of concerns
- Type-safe data pipeline
- Extensible block system
- Non-intrusive integration pattern

The documentation provides:
- Complete architecture reference
- Step-by-step implementation guide
- Visual explanations and diagrams
- Quick reference checklists
- Risk assessments and recommendations

You're ready to build a component library!

---

*Documentation created: October 31, 2025*
*Total lines of documentation: 1,100+*
*Files generated: 5 comprehensive guides*
