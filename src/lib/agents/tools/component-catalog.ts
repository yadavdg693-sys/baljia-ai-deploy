// Curated component catalog for the engineering agent.
//
// Every github_fork_skeleton fork inherits the 12 shadcn/ui components below
// at components/ui/ (lowercase filenames, canonical shadcn convention). The
// agent should import from there — hand-rolling buttons, cards, inputs,
// dialogs etc. is a quality-bar violation. This catalog tells the agent
// which component fits each job, which variants to use, and which patterns
// are explicitly forbidden.
//
// Hand-authored. Keep grep-friendly and opinionated. Do NOT bloat with every
// possible permutation — every line should be load-bearing.

export const COMPONENT_CATALOG = `## Shadcn/UI Component Catalog (in components/ui/ of every founder fork)

Import path: \`@/components/ui/{component-name}\` (lowercase). All components
are canonical shadcn/ui — they use the brand tokens in \`app/globals.css\`
(\`bg-primary\`, \`text-primary-foreground\`, \`hover:bg-accent\`, etc.).
NEVER hand-roll an equivalent.

To install MORE components beyond this list, run in the founder repo root:
\`npx shadcn@latest add <name>\` (e.g. \`alert-dialog\`, \`avatar\`, \`tooltip\`).

### button (button.tsx)
Import: \`import { Button } from "@/components/ui/button"\`
Variants: default | secondary | ghost | destructive | outline | link
Sizes: default | sm | lg | icon
Use for: hero CTA (default + lg), in-card actions (ghost), destructive
operations (destructive), tertiary actions (link or ghost).
Anti-pattern: NEVER use 'bg-gradient-to-r from-...' on a Button. NEVER use
emoji as button text — use the lucide-react icon set, slot it via
\`<Button><Icon className="mr-2 h-4 w-4" />Label</Button>\`.

### card (card.tsx)
Import: \`import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"\`
Use for: feature tiles, dashboard panels, pricing cards, content blocks.
Anti-pattern: NEVER add \`border-l-4 border-{color}\` to a Card. The
"rounded card with colored left-border accent" is the canonical AI dashboard
tile tell — drop the radius OR drop the left border, never both. Cards with
emoji icons in the top-left rounded square are also banned.

### input (input.tsx)
Import: \`import { Input } from "@/components/ui/input"\`
Use for: text input, email, password, search, any single-line entry.
Always pair with \`<Label>\` from \`@/components/ui/label\`. The component
already encodes focus-visible:ring-ring — don't override.

### label (label.tsx)
Import: \`import { Label } from "@/components/ui/label"\`
Use for: associating labels with form inputs. Always use with Input/Textarea.

### dialog (dialog.tsx)
Import: \`import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"\`
Use for: confirmation flows, info modals, form-in-modal patterns. Uses Radix
primitives — focus is trapped correctly. DO NOT roll your own modal.

### badge (badge.tsx)
Import: \`import { Badge } from "@/components/ui/badge"\`
Variants: default | secondary | destructive | outline
Use for: status indicators, tag chips, count pills.
Anti-pattern: NEVER use Badge as decorative "section header underline" — it's
a data marker, not visual filigree.

### dropdown-menu (dropdown-menu.tsx)
Import: \`import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu"\`
Use for: action menus, user menus, sort/filter menus.

### tabs (tabs.tsx)
Import: \`import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"\`
Use for: settings panels, sectioned content. Don't use Tabs as a navigation
substitute — nav goes in app/layout.tsx as proper anchor links.

### textarea (textarea.tsx)
Import: \`import { Textarea } from "@/components/ui/textarea"\`
Use for: multi-line input — feedback forms, chat composer, comment boxes.

### scroll-area (scroll-area.tsx)
Import: \`import { ScrollArea } from "@/components/ui/scroll-area"\`
Use for: bounded scroll regions (sidebars, long content lists, chat history).
Default overflow-y-auto renders native browser scrollbar — use ScrollArea
for styled, consistent cross-browser appearance.

### skeleton (skeleton.tsx)
Import: \`import { Skeleton } from "@/components/ui/skeleton"\`
Use for: loading placeholders. Match the dimensions of the content that will
appear (e.g. \`<Skeleton className="h-8 w-32" />\` for a title). FORBIDDEN:
showing "Loading..." text in a Card. Skeleton always.

### sonner (sonner.tsx) — Toaster
Import: \`import { Toaster } from "@/components/ui/sonner"\` (mount once in layout)
Then: \`import { toast } from "sonner"\` (use anywhere)
Use for: transient notifications. \`toast.success(...)\`, \`toast.error(...)\`,
\`toast(...)\`. Reserve for non-blocking feedback. Don't use for required
actions — that's Dialog's job.

---

## Icon library

Use \`lucide-react\` for ALL icons. NEVER emoji in headings, labels, or icon
slots. Choose monoline icons at default 24px (\`className="h-4 w-4"\` or
\`h-5 w-5\` inline). Examples:
\`import { ChevronRight, Search, Plus, X, Check, AlertCircle } from "lucide-react";\`

## Anti-pattern global checklist (any of these = quality bar violation)

- Hand-rolled \`<button>\` with inline \`style="..."\` instead of \`<Button>\`
- \`<div className="border rounded-lg p-4">\` content block instead of \`<Card>\`
- Bare \`<input>\` instead of \`<Input>\` + \`<Label>\`
- "Lorem ipsum", "feature one/two/three", or "sample content" anywhere
- Emoji in any \`<h1>\`, \`<h2>\`, \`<h3>\`, or icon slot
- Tailwind default indigo as accent (\`from-indigo\`, \`bg-indigo-500\`, etc.)
- Two-stop trust gradient on hero (\`from-purple-500 to-blue-500\`, etc.)
- \`text-center max-w-2xl mx-auto\` hero centering (the AI-default tell)
- \`grid grid-cols-3 gap-8\` symmetric feature grid — use \`grid-cols-2\` or
  asymmetric layouts (\`md:grid-cols-[2fr_1fr]\`)
- "Hero → Features → Pricing → FAQ → CTA" template sequence — introduce one
  unconventional section (testimonial pull-quote, comparison-against-status-quo,
  inline demo, kbd shortcut wall)
- Invented metrics: "10× faster", "99.9% uptime", "3× more productive" without
  citation
- API documentation, curl examples, or HTTP method badges on a public-facing
  user landing page — those belong at /docs, never at /
- Native dangerouslySetInnerHTML — use a proper markdown lib (\`react-markdown\`
  with sanitization) for LLM-generated content
`;
