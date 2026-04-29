"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  Search,
  Sparkles,
  Copy,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  BookOpen,
  FileText,
  Globe,
  BookMarked,
  Lightbulb,
  Zap,
  HelpCircle,
  Settings2,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResearchProgress } from "@/components/research-progress";
import { SourceBadge } from "@/components/source-badge";
import { ProviderIndicator } from "@/components/provider-indicator";
import { ConfidenceMeter } from "@/components/confidence-meter";
import {
  researchApi,
  ResearchResult,
  ResearchMethod,
  ResearchSession,
  BookSearchResult,
  getMethodDisplayName,
  getMethodIconName,
  getSourceTypeInfo,
  getProviderDisplayName,
} from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type ResearchStep = "retrieving" | "planning" | "synthesizing" | "generating";

// Generate years from 1900 to current year
const currentYear = new Date().getFullYear();
const years = Array.from(
  { length: currentYear - 1900 + 1 },
  (_, i) => currentYear - i,
);

// Dynamic icon component
const MethodIcon = ({
  method,
  className,
}: {
  method: ResearchMethod;
  className?: string;
}) => {
  const iconName = getMethodIconName(method);

  switch (iconName) {
    case "BookMarked":
      return <BookMarked className={className} />;
    case "Zap":
      return <Zap className={className} />;
    case "Lightbulb":
      return <Lightbulb className={className} />;
    case "Globe":
      return <Globe className={className} />;
    case "Sparkles":
      return <Sparkles className={className} />;
    default:
      return <HelpCircle className={className} />;
  }
};

function ResearchPageContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const sessionId = searchParams.get("session");

  const [query, setQuery] = useState(initialQuery);
  const [topK, setTopK] = useState(5);

  // Method selection
  const [showAdvancedMethods, setShowAdvancedMethods] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<ResearchMethod>(
    ResearchMethod.ALL,
  );

  // Date filters
  const [startYear, setStartYear] = useState<number | null>(null);
  const [endYear, setEndYear] = useState<number | null>(null);

  // UI state
  const [isResearching, setIsResearching] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [currentStep, setCurrentStep] = useState<ResearchStep>("retrieving");
  const [completedSteps, setCompletedSteps] = useState<ResearchStep[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [isPlanOpen, setIsPlanOpen] = useState(false);

  // Load session if sessionId is present
  useEffect(() => {
    async function loadSession() {
      if (sessionId) {
        setIsLoadingSession(true);
        try {
          const { data, error } = await researchApi.getSession(sessionId);
          if (error) {
            toast.error("Failed to load research session");
          } else if (data) {
            // Parse the plan if it exists
            let researchPlan: string[] = [];
            if (data.research_plan) {
              try {
                researchPlan =
                  typeof data.research_plan === "string"
                    ? JSON.parse(data.research_plan)
                    : data.research_plan;
              } catch (e) {
                researchPlan = [];
              }
            }

            // Map the session data to ResearchResult format
            const researchResult: ResearchResult = {
              id: data.id ? parseInt(data.id) : undefined,
              query: data.query,
              answer: data.answer,
              research_plan: researchPlan,
              sources: (data.sources || []).map((source: BookSearchResult) => ({
                title: source.title || "Unknown source",
                author: source.author,
                similarity: source.similarity || 0,
                date_published: source.date_published,
              })),
              confidence: data.confidence || 0.7,
              source_type: (data.source_type as any) || "library",
              research_method:
                (data.research_method as ResearchMethod) || ResearchMethod.ALL,
              provider: data.provider || "github",
              provider_log: [],
              status: "completed",
              filter_info: data.filter_info,
            };
            setResult(researchResult);
            setQuery(data.query);
          }
        } catch (error) {
          toast.error("Error loading session");
          console.error(error);
        } finally {
          setIsLoadingSession(false);
        }
      }
    }

    loadSession();
  }, [sessionId]);

  // Auto-start research if query param is present (and no session is being loaded)
  useEffect(() => {
    if (initialQuery && !result && !isResearching && !sessionId) {
      handleResearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const simulateProgress = async () => {
    const steps: ResearchStep[] = [
      "retrieving",
      "planning",
      "synthesizing",
      "generating",
    ];

    for (let i = 0; i < steps.length; i++) {
      setCurrentStep(steps[i]);
      if (i > 0) {
        setCompletedSteps(steps.slice(0, i));
      }

      // Simulate different speeds based on method and date filters
      let baseDelay = 800;

      if (startYear || endYear) {
        baseDelay += 300; // Extra time for date range filtering
      }

      switch (selectedMethod) {
        case ResearchMethod.LIBRARY_ONLY:
          baseDelay = 600; // Faster - just library search
          break;
        case ResearchMethod.SUGGEST_BOOKS:
          baseDelay = 500; // Fastest - just suggestions
          break;
        case ResearchMethod.LLM_GENERAL:
          baseDelay = 700; // Fast - no retrieval
          break;
        case ResearchMethod.WEB_FALLBACK:
          baseDelay = 900; // Slower - may need web fallback
          break;
        case ResearchMethod.ALL:
          baseDelay = 1000; // Slowest - tries everything
          break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, baseDelay + Math.random() * 500),
      );
    }
    setCompletedSteps(steps);
  };

  const handleResearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a research question");
      return;
    }

    const methodDisplay = getMethodDisplayName(selectedMethod);
    const dateRangeDisplay = startYear
      ? endYear
        ? ` from ${startYear} to ${endYear}`
        : ` from ${startYear} onwards`
      : "";

    toast.info(`Researching with method: ${methodDisplay}${dateRangeDisplay}`, {
      duration: 3000,
    });

    setIsResearching(true);
    setResult(null);
    setCompletedSteps([]);
    setCurrentStep("retrieving");

    try {
      // Start progress simulation
      const progressPromise = simulateProgress();

      // Convert years to dates
      let startDate: Date | null = null;
      let endDate: Date | null = null;

      if (startYear) {
        startDate = new Date(startYear, 0, 1); // January 1st of start year
      }

      if (endYear) {
        endDate = new Date(endYear, 11, 31); // December 31st of end year
      }

      // Make API call with selected method and date filters
      const { data, error } = await researchApi.query(
        query,
        topK,
        selectedMethod,
        startDate,
        endDate,
      );

      // Wait for progress animation
      await progressPromise;

      if (error) {
        toast.error(error);
        setIsResearching(false);
        return;
      }

      if (data) {
        setResult(data);

        // Show filter info toast if applicable
        if (data.filter_info?.applied && data.sources.length > 0) {
          const dateRange =
            data.filter_info.start_date && data.filter_info.end_date
              ? `from ${new Date(data.filter_info.start_date).getFullYear()} to ${new Date(data.filter_info.end_date).getFullYear()}`
              : `from ${new Date(data.filter_info.start_date).getFullYear()} onwards`;
          toast.success(
            `Found ${data.sources.length} books published ${dateRange}`,
            {
              description: `Filtered from ${data.filter_info.total_books_considered || "several"} books in your library`,
            },
          );
        }

        // Show method-specific toast
        if (data.source_type === "suggestion") {
          toast.success("Here are some book recommendations for you!", {
            description: `Based on your query: "${data.query.substring(0, 50)}${data.query.length > 50 ? "..." : ""}"`,
          });
        } else if (data.source_type === "llm_general") {
          toast.info("Answer based on general knowledge", {
            description: "No library books were found for this topic.",
          });
        } else if (data.source_type === "web") {
          toast.info("Answer includes web fallback results", {
            description: "Combined with library sources where available.",
          });
        } else if (data.source_type === "library") {
          toast.success(
            `Answer synthesized from ${data.sources.length} books`,
            {
              description: `Confidence: ${Math.round(data.confidence * 100)}%`,
            },
          );
        } else if (data.source_type === "error") {
          toast.error("Research encountered an error", {
            description: data.answer,
          });
        }
      }
    } catch (error) {
      toast.error("Failed to complete research");
      console.error(error);
    } finally {
      setIsResearching(false);
    }
  };

  const handleCopy = () => {
    if (result?.answer) {
      navigator.clipboard.writeText(result.answer);
      toast.success("Answer copied to clipboard");
    }
  };

  const handleExport = () => {
    if (!result) return;

    let filterSection = "";
    if (result.filter_info?.applied) {
      const startYear = new Date(result.filter_info.start_date).getFullYear();
      if (result.filter_info.end_date) {
        const endYear = new Date(result.filter_info.end_date).getFullYear();
        filterSection = `# Date Filter\n\nFilter applied: Books published from ${startYear} to ${endYear}\nBooks found: ${result.filter_info.books_found}\n\n`;
      } else {
        filterSection = `# Date Filter\n\nFilter applied: Books published from ${startYear} onwards\nBooks found: ${result.filter_info.books_found}\n\n`;
      }
    }

    const content =
      `# Research Query\n\n${result.query}\n\n` +
      `# Research Method\n\n${getMethodDisplayName(result.research_method)}\n\n` +
      `# Source Type\n\n${result.source_type}\n\n` +
      `# Provider\n\n${getProviderDisplayName(result.provider)}\n\n` +
      `# Confidence\n\n${Math.round(result.confidence * 100)}%\n\n` +
      filterSection +
      `# Research Plan\n\n${result.research_plan.map((step, i) => `${i + 1}. ${step}`).join("\n")}\n\n` +
      `# Answer\n\n${result.answer}\n\n` +
      `# Sources\n\n${result.sources.map((s) => `- ${s.title} by ${s.author || "Unknown"} (${Math.round(s.similarity * 100)}% relevance)${s.date_published ? ` [Published: ${format(new Date(s.date_published), "yyyy")}]` : ""}`).join("\n")}\n\n` +
      `# Provider Log\n\n${result.provider_log.map((log) => `- ${log.step}: ${log.provider}/${log.model || "unknown"}${log.filter ? ` (${log.filter})` : ""}`).join("\n")}`;

    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported as Markdown");
  };

  const handleNewResearch = () => {
    setQuery("");
    setResult(null);
    setCompletedSteps([]);
    setSelectedMethod(ResearchMethod.ALL);
    setShowAdvancedMethods(false);
    setStartYear(null);
    setEndYear(null);
  };

  const clearDateFilters = () => {
    setStartYear(null);
    setEndYear(null);
  };

  // Check if current method supports date filtering
  const supportsDateFilter = (method: ResearchMethod): boolean => {
    return (
      method === ResearchMethod.LIBRARY_ONLY ||
      method === ResearchMethod.SUGGEST_BOOKS
    );
  };

  // Show loading state while fetching session
  if (isLoadingSession) {
    return (
      <div className="container py-8 px-4 max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container py-8 px-4 max-w-7xl mx-auto">
        {/* Show back button when viewing a session */}
        {sessionId && result && (
          <Button
            variant="ghost"
            className="mb-4"
            onClick={() => window.history.back()}
          >
            ← Back to History
          </Button>
        )}

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Academic Research Assistant
          </h1>
          <p className="text-muted-foreground">
            Ask complex research questions and get synthesized answers from your
            library
          </p>
        </div>

        {/* Research Input Section - Only show when not viewing a session */}
        {!sessionId && !result && !isResearching && (
          <Card className="mb-8 border-2 border-border/50">
            <CardHeader>
              <CardTitle>New Research Query</CardTitle>
              <CardDescription>
                Enter your question and configure research options
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Query Input */}
              <div>
                <Label htmlFor="query" className="text-base font-medium">
                  Research Question
                </Label>
                <Textarea
                  id="query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., What are the main theories of learning in educational psychology?"
                  className="mt-2 min-h-[120px] text-base"
                />
              </div>

              {/* Basic Options - Always Visible */}
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Number of sources</Label>
                    <span className="text-sm text-muted-foreground">
                      {topK}
                    </span>
                  </div>
                  <Slider
                    value={[topK]}
                    onValueChange={([value]) => setTopK(value)}
                    min={1}
                    max={10}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Quick (1-2)</span>
                    <span>Balanced (3-5)</span>
                    <span>Deep (6-10)</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="flex items-center gap-1">
                        <Settings2 className="h-3.5 w-3.5" />
                        Advanced Research Methods
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Toggle to choose specific research strategies
                      </p>
                    </div>
                    <Switch
                      checked={showAdvancedMethods}
                      onCheckedChange={setShowAdvancedMethods}
                    />
                  </div>
                </div>
              </div>

              {/* Advanced Methods - Only visible when toggled */}
              {showAdvancedMethods && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">Research Method</h3>
                      <Badge variant="outline" className="gap-1">
                        <MethodIcon
                          method={selectedMethod}
                          className="h-3 w-3"
                        />
                        {getMethodDisplayName(selectedMethod)}
                      </Badge>
                    </div>

                    <RadioGroup
                      value={selectedMethod}
                      onValueChange={(value) => {
                        setSelectedMethod(value as ResearchMethod);
                        // Clear date filters when switching to non-library method
                        if (!supportsDateFilter(value as ResearchMethod)) {
                          clearDateFilters();
                        }
                      }}
                      className="grid gap-3 md:grid-cols-2"
                    >
                      {/* All Methods (Smart Selection) */}
                      <div
                        className={cn(
                          "flex items-start space-x-2 rounded-lg border p-3",
                          selectedMethod === ResearchMethod.ALL &&
                            "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem
                          value={ResearchMethod.ALL}
                          id="all"
                          className="mt-1"
                        />
                        <Label htmlFor="all" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span className="font-medium">Smart Selection</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Automatically chooses best method based on your
                            library
                          </p>
                        </Label>
                      </div>

                      {/* Library Only - WITH DATE RANGE SELECTOR */}
                      <div
                        className={cn(
                          "flex items-start space-x-2 rounded-lg border p-3 relative",
                          selectedMethod === ResearchMethod.LIBRARY_ONLY &&
                            "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem
                          value={ResearchMethod.LIBRARY_ONLY}
                          id="library"
                          className="mt-1"
                        />
                        <Label
                          htmlFor="library"
                          className="flex-1 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <BookMarked className="h-4 w-4 text-blue-500" />
                            <span className="font-medium">Library Only</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Strictly use your uploaded books
                          </p>

                          {/* Date range selector integrated directly in the card */}
                          {selectedMethod === ResearchMethod.LIBRARY_ONLY && (
                            <div className="mt-3 pt-2 border-t border-border/50">
                              <div className="flex items-center gap-2 mb-2">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs font-medium">
                                  Filter by publication year:
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs">From year</Label>
                                  <Select
                                    value={startYear?.toString() || "any"}
                                    onValueChange={(value) => {
                                      if (value === "any") {
                                        setStartYear(null);
                                      } else {
                                        setStartYear(parseInt(value));
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Start year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="any">
                                        Any year
                                      </SelectItem>
                                      {years.map((year) => (
                                        <SelectItem
                                          key={year}
                                          value={year.toString()}
                                        >
                                          {year}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">To year</Label>
                                  <Select
                                    value={endYear?.toString() || "none"}
                                    onValueChange={(value) => {
                                      if (value === "none") {
                                        setEndYear(null);
                                      } else {
                                        setEndYear(parseInt(value));
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="End year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">
                                        No end
                                      </SelectItem>
                                      {years.map((year) => (
                                        <SelectItem
                                          key={year}
                                          value={year.toString()}
                                        >
                                          {year}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              {(startYear || endYear) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    clearDateFilters();
                                  }}
                                  className="mt-2 h-6 px-2 w-full text-xs"
                                >
                                  Clear date filters
                                </Button>
                              )}
                              {startYear && endYear && endYear < startYear && (
                                <p className="text-[10px] text-red-500 mt-1">
                                  End year must be after start year
                                </p>
                              )}
                            </div>
                          )}
                        </Label>
                      </div>

                      {/* Web Fallback */}
                      <div
                        className={cn(
                          "flex items-start space-x-2 rounded-lg border p-3",
                          selectedMethod === ResearchMethod.WEB_FALLBACK &&
                            "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem
                          value={ResearchMethod.WEB_FALLBACK}
                          id="web"
                          className="mt-1"
                        />
                        <Label htmlFor="web" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-green-500" />
                            <span className="font-medium">Web Fallback</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Try library first, then search web if needed
                          </p>
                        </Label>
                      </div>

                      {/* LLM General Knowledge */}
                      <div
                        className={cn(
                          "flex items-start space-x-2 rounded-lg border p-3",
                          selectedMethod === ResearchMethod.LLM_GENERAL &&
                            "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem
                          value={ResearchMethod.LLM_GENERAL}
                          id="llm"
                          className="mt-1"
                        />
                        <Label htmlFor="llm" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-purple-500" />
                            <span className="font-medium">
                              LLM General Knowledge
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Use AI's general knowledge directly
                          </p>
                        </Label>
                      </div>

                      {/* Suggest Books - WITH DATE RANGE SELECTOR */}
                      <div
                        className={cn(
                          "flex items-start space-x-2 rounded-lg border p-3 md:col-span-2 relative",
                          selectedMethod === ResearchMethod.SUGGEST_BOOKS &&
                            "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem
                          value={ResearchMethod.SUGGEST_BOOKS}
                          id="suggest"
                          className="mt-1"
                        />
                        <Label
                          htmlFor="suggest"
                          className="flex-1 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Lightbulb className="h-4 w-4 text-amber-500" />
                            <span className="font-medium">Suggest Books</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Get recommendations outside your library
                          </p>

                          {/* Date range selector integrated directly in the card */}
                          {selectedMethod === ResearchMethod.SUGGEST_BOOKS && (
                            <div className="mt-3 pt-2 border-t border-border/50">
                              <div className="flex items-center gap-2 mb-2">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs font-medium">
                                  Filter by publication year:
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs">From year</Label>
                                  <Select
                                    value={startYear?.toString() || "any"}
                                    onValueChange={(value) => {
                                      if (value === "any") {
                                        setStartYear(null);
                                      } else {
                                        setStartYear(parseInt(value));
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Start year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="any">
                                        Any year
                                      </SelectItem>
                                      {years.map((year) => (
                                        <SelectItem
                                          key={year}
                                          value={year.toString()}
                                        >
                                          {year}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">To year</Label>
                                  <Select
                                    value={endYear?.toString() || "none"}
                                    onValueChange={(value) => {
                                      if (value === "none") {
                                        setEndYear(null);
                                      } else {
                                        setEndYear(parseInt(value));
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="End year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">
                                        No end
                                      </SelectItem>
                                      {years.map((year) => (
                                        <SelectItem
                                          key={year}
                                          value={year.toString()}
                                        >
                                          {year}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              {(startYear || endYear) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    clearDateFilters();
                                  }}
                                  className="mt-2 h-6 px-2 w-full text-xs"
                                >
                                  Clear date filters
                                </Button>
                              )}
                              {startYear && endYear && endYear < startYear && (
                                <p className="text-[10px] text-red-500 mt-1">
                                  End year must be after start year
                                </p>
                              )}
                            </div>
                          )}
                        </Label>
                      </div>
                    </RadioGroup>

                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Current method:</span>{" "}
                        {selectedMethod === ResearchMethod.ALL &&
                          "Smart Selection - automatically chooses best approach"}
                        {selectedMethod === ResearchMethod.LIBRARY_ONLY &&
                          "Library Only - answers only from your books"}
                        {selectedMethod === ResearchMethod.WEB_FALLBACK &&
                          "Web Fallback - checks library first, then web"}
                        {selectedMethod === ResearchMethod.LLM_GENERAL &&
                          "LLM General Knowledge - uses AI knowledge"}
                        {selectedMethod === ResearchMethod.SUGGEST_BOOKS &&
                          "Suggest Books - recommends books to acquire"}
                      </p>
                    </div>

                    {/* Show active filter summary */}
                    {(startYear || endYear) &&
                      supportsDateFilter(selectedMethod) && (
                        <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                          <Calendar className="h-4 w-4 text-blue-500" />
                          <span className="text-xs">
                            Active filter: Books published
                            {startYear && endYear
                              ? ` from ${startYear} to ${endYear}`
                              : startYear
                                ? ` from ${startYear} onwards`
                                : endYear
                                  ? ` up to ${endYear}`
                                  : ""}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearDateFilters}
                            className="h-6 px-2 ml-auto text-xs"
                          >
                            Clear
                          </Button>
                        </div>
                      )}
                  </div>
                </>
              )}

              <Button
                onClick={handleResearch}
                size="lg"
                className="w-full gap-2"
                disabled={isResearching}
              >
                {isResearching ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Researching...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Start Research{" "}
                    {(startYear || endYear) &&
                      `(${startYear ? `from ${startYear}` : ""}${startYear && endYear ? " to " : ""}${endYear ? `to ${endYear}` : ""})`}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Research Progress */}
        {isResearching && (
          <Card className="mb-8 border-2 border-primary/20">
            <CardHeader>
              <CardTitle>Researching...</CardTitle>
              <CardDescription className="line-clamp-1">
                <span className="font-medium text-foreground">Query:</span>{" "}
                {query}
                {(startYear || endYear) &&
                  supportsDateFilter(selectedMethod) && (
                    <span className="ml-2 text-sm text-muted-foreground">
                      (Filter: {startYear ? `from ${startYear}` : ""}
                      {startYear && endYear ? " to " : ""}
                      {endYear ? `to ${endYear}` : ""})
                    </span>
                  )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResearchProgress
                currentStep={currentStep}
                completedSteps={completedSteps}
              />
            </CardContent>
          </Card>
        )}

        {/* Research Results */}
        {result && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Panel: Answer */}
            <div className="lg:col-span-2 space-y-4">
              <Card className="border-2 border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg mb-1">
                        Research Question
                      </CardTitle>
                      <p className="text-muted-foreground">{result.query}</p>

                      {/* Display filter info if applied */}
                      {result.filter_info?.applied && (
                        <div className="mt-2">
                          <Badge
                            variant="outline"
                            className="gap-1 py-1 bg-blue-50 dark:bg-blue-950"
                          >
                            <Calendar className="h-3.5 w-3.5" />
                            {result.filter_info.start_date &&
                            result.filter_info.end_date
                              ? `Filtered: Books from ${new Date(result.filter_info.start_date).getFullYear()} to ${new Date(result.filter_info.end_date).getFullYear()}`
                              : `Filtered: Books from ${new Date(result.filter_info.start_date).getFullYear()} onwards`}
                            {result.filter_info.books_found > 0 && (
                              <span className="ml-1">
                                ({result.filter_info.books_found} books found)
                              </span>
                            )}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <SourceBadge type={result.source_type as any} />
                      <Badge variant="outline" className="gap-1 py-1">
                        <MethodIcon
                          method={result.research_method}
                          className="h-3.5 w-3.5"
                        />
                        {getMethodDisplayName(result.research_method)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => (
                          <h1 className="text-2xl font-bold mt-6 mb-4">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-xl font-semibold mt-5 mb-3">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-lg font-medium mt-4 mb-2">
                            {children}
                          </h3>
                        ),
                        p: ({ children }) => (
                          <p className="mb-4 leading-relaxed">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc pl-6 mb-4 space-y-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal pl-6 mb-4 space-y-1">
                            {children}
                          </ol>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-accent pl-4 italic text-muted-foreground my-4">
                            {children}
                          </blockquote>
                        ),
                        code: ({ className, children }) => {
                          const isInline = !className;
                          return isInline ? (
                            <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                              {children}
                            </code>
                          ) : (
                            <code className="block bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto">
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {result.answer}
                    </ReactMarkdown>
                  </div>

                  {/* Provider Log */}
                  {result.provider_log && result.provider_log.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-border">
                      <h4 className="text-sm font-medium mb-2">
                        Research Steps:
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {result.provider_log.map((log, idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="text-xs"
                          >
                            {log.step}: {log.provider}
                            {log.filter && ` (${log.filter})`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-border">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy answer
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport}>
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNewResearch}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      New research
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel: Sources & Reasoning */}
            <div className="space-y-4">
              {/* Research Plan */}
              {result.research_plan && result.research_plan.length > 0 && (
                <Collapsible open={isPlanOpen} onOpenChange={setIsPlanOpen}>
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Search className="h-4 w-4" />
                            Research Plan
                          </CardTitle>
                          {isPlanOpen ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        <ol className="space-y-2">
                          {result.research_plan.map((step, index) => (
                            <li key={index} className="flex gap-3 text-sm">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                                {index + 1}
                              </span>
                              <span className="text-muted-foreground pt-0.5">
                                {step}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}

              {/* Confidence */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Confidence Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <ConfidenceMeter
                    score={result.confidence}
                    label={`Based on ${result.sources.length} source${result.sources.length !== 1 ? "s" : ""}`}
                  />
                  {result.source_type === "llm_general" && (
                    <p className="text-xs text-muted-foreground mt-2">
                      ⚠️ Lower confidence because no library books were used
                    </p>
                  )}
                  {result.source_type === "suggestion" && (
                    <p className="text-xs text-muted-foreground mt-2">
                      💡 These are book recommendations, not an answer to your
                      query
                    </p>
                  )}
                  {result.filter_info?.applied &&
                    result.sources.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        🔍 No books found in the selected date range
                      </p>
                    )}
                </CardContent>
              </Card>


              {/* Sources */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {result.research_method === ResearchMethod.SUGGEST_BOOKS
                      ? "Related Sources in Library"
                      : "Sources Used"}
                  </CardTitle>
                  <CardDescription>
                    {result.sources.length} book
                    {result.sources.length !== 1 ? "s" : ""}
                    {result.research_method === ResearchMethod.SUGGEST_BOOKS
                      ? " found in your library matching the recommendations"
                      : " referenced"}
                    {result.filter_info?.applied &&
                      result.sources.length > 0 && (
                        <span className="block text-xs mt-1">
                          {result.filter_info.start_date &&
                          result.filter_info.end_date
                            ? `Filtered: ${new Date(result.filter_info.start_date).getFullYear()} - ${new Date(result.filter_info.end_date).getFullYear()}`
                            : `Filtered: from ${new Date(result.filter_info.start_date).getFullYear()} onwards`}
                        </span>
                      )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-3">
                      {result.sources.map((source, index) => (
                        <SourceCard key={index} source={source} />
                      ))}
                      {result.sources.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>
                            {result.research_method ===
                            ResearchMethod.SUGGEST_BOOKS
                              ? "No matching books found in your library"
                              : "No library sources used"}
                          </p>
                          {result.source_type === "suggestion" && (
                            <p className="text-sm mt-2">
                              These are book recommendations to add to your
                              library
                            </p>
                          )}
                          {result.source_type === "llm_general" && (
                            <p className="text-sm mt-2">
                              Answer based on AI general knowledge
                            </p>
                          )}
                          {result.filter_info?.applied && (
                            <p className="text-sm mt-2">
                              No books found in the selected date range
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
              
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// Source Card Component with Year Display
function SourceCard({
  source,
}: {
  source: {
    title: string;
    similarity: number;
    author?: string;
    date_published?: string;
  };
}) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm text-card-foreground line-clamp-1">
            {source.title}
          </h4>
          <p className="text-xs text-muted-foreground">
            {source.author || "Unknown Author"}
            {source.date_published && (
              <span className="ml-2">
                • {format(new Date(source.date_published), "yyyy")}
              </span>
            )}
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Relevance</span>
              <span className="font-medium">
                {Math.round(source.similarity * 100)}%
              </span>
            </div>
            <Progress value={source.similarity * 100} className="h-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Loading fallback
function ResearchPageSkeleton() {
  return (
    <div className="container py-8 px-4 max-w-7xl mx-auto">
      <Skeleton className="h-10 w-64 mb-4" />
      <Skeleton className="h-6 w-96 mb-8" />
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<ResearchPageSkeleton />}>
      <ResearchPageContent />
    </Suspense>
  );
}
