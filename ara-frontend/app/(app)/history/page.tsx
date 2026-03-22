"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Calendar,
  ChevronRight,
  Download,
  Bookmark,
  RefreshCw,
  Filter,
  Sparkles,
  BookMarked,
  Zap,
  Lightbulb,
  Globe,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { SourceBadge } from "@/components/source-badge";
import { ConfidenceMeter } from "@/components/confidence-meter";
import { researchApi, ResearchSession, getMethodDisplayName, getMethodIconName } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TimeFilter = "all" | "today" | "week" | "month";
type SourceFilter = "all" | "library" | "web" | "general";

// Method icon component
const MethodIcon = ({ method, className }: { method: string; className?: string }) => {
  const iconName = getMethodIconName(method as any);
  
  switch(iconName) {
    case 'BookMarked':
      return <BookMarked className={className} />;
    case 'Zap':
      return <Zap className={className} />;
    case 'Lightbulb':
      return <Lightbulb className={className} />;
    case 'Globe':
      return <Globe className={className} />;
    case 'Sparkles':
      return <Sparkles className={className} />;
    default:
      return <HelpCircle className={className} />;
  }
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function isThisWeek(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return date >= weekAgo;
}

function isThisMonth(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  return (
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

// Group sessions by date
function groupByDate(
  sessions: ResearchSession[],
): Map<string, ResearchSession[]> {
  const groups = new Map<string, ResearchSession[]>();

  sessions.forEach((session) => {
    const dateKey = formatDate(session.created_at);
    const existing = groups.get(dateKey) || [];
    groups.set(dateKey, [...existing, session]);
  });

  return groups;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [selectedSession, setSelectedSession] =
    useState<ResearchSession | null>(null);

  useEffect(() => {
    async function loadHistory() {
      setIsLoading(true);
      const { data, error } = await researchApi.getHistory();
      if (error) {
        toast.error("Failed to load history");
      } else if (data) {
        setSessions(data);
      }
      setIsLoading(false);
    }
    loadHistory();
  }, []);

  // Filter sessions
  const filteredSessions = sessions
    .filter((session) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          session.query.toLowerCase().includes(query) ||
          session.answer.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .filter((session) => {
      // Time filter
      switch (timeFilter) {
        case "today":
          return isToday(session.created_at);
        case "week":
          return isThisWeek(session.created_at);
        case "month":
          return isThisMonth(session.created_at);
        default:
          return true;
      }
    })
    .filter((session) => {
      // Source filter
      if (sourceFilter === "all") return true;
      return session.source_type === sourceFilter;
    });

  const groupedSessions = groupByDate(filteredSessions);

  const handleExportCSV = () => {
    const csv = [
      [
        "Date",
        "Time",
        "Query",
        "Research Method",
        "Source Type",
        "Confidence",
        "Sources Count",
      ].join(","),
      ...filteredSessions.map((s) =>
        [
          formatDate(s.created_at),
          formatTime(s.created_at),
          `"${s.query.replace(/"/g, '""')}"`,
          getMethodDisplayName(s.research_method as any),
          s.source_type,
          Math.round(s.confidence * 100) + "%",
          s.sources.length,
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("History exported as CSV");
  };

  return (
    <div className="container py-8 px-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Research History
          </h1>
          <p className="text-muted-foreground">
            View and manage past research sessions
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={filteredSessions.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={timeFilter}
            onValueChange={(v) => setTimeFilter(v as TimeFilter)}
          >
            <SelectTrigger className="w-[140px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v as SourceFilter)}
          >
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="library">Library</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline List */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="space-y-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              ))}
            </div>
          ) : filteredSessions.length > 0 ? (
            <div className="space-y-8">
              {Array.from(groupedSessions.entries()).map(
                ([date, dateSessions]) => (
                  <div key={date}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <Calendar className="h-4 w-4 text-primary" />
                      </div>
                      <h2 className="font-semibold text-foreground">{date}</h2>
                      <Badge variant="secondary">{dateSessions.length}</Badge>
                    </div>
                    <div className="space-y-3 ml-4 border-l-2 border-border pl-6">
                      {dateSessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={() => setSelectedSession(session)}
                          className={cn(
                            "w-full text-left p-4 rounded-lg border border-border bg-card hover:shadow-md transition-all group",
                            selectedSession?.id === session.id &&
                              "ring-2 ring-primary border-primary",
                          )}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-card-foreground line-clamp-2 mb-2 group-hover:text-primary transition-colors">
                                {session.query}
                              </p>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {session.answer.slice(0, 150)}...
                              </p>
                              <div className="flex items-center gap-2 mt-3 flex-wrap">
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(session.created_at)}
                                </span>
                                <SourceBadge type={session.source_type} />
                                <Badge variant="outline" className="text-xs gap-1">
                                  <MethodIcon method={session.research_method} className="h-3 w-3" />
                                  {getMethodDisplayName(session.research_method as any)}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {session.sources.length} sources
                                </Badge>
                              </div>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <Search className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-medium text-foreground mb-1">
                  {searchQuery || timeFilter !== "all" || sourceFilter !== "all"
                    ? "No matching results"
                    : "No research history yet"}
                </h3>
                <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                  {searchQuery || timeFilter !== "all" || sourceFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Start researching to build your history"}
                </p>
                {!searchQuery &&
                  timeFilter === "all" &&
                  sourceFilter === "all" && (
                    <Button asChild>
                      <Link href="/research">Start Research</Link>
                    </Button>
                  )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {selectedSession ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg line-clamp-2">
                      {selectedSession.query}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {formatDate(selectedSession.created_at)} at{" "}
                      {formatTime(selectedSession.created_at)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col gap-2">
                    <SourceBadge type={selectedSession.source_type} />
                    <Badge variant="outline" className="gap-1">
                      <MethodIcon method={selectedSession.research_method} className="h-3 w-3" />
                      {getMethodDisplayName(selectedSession.research_method as any)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Answer Preview</h4>
                  <p className="text-sm text-muted-foreground line-clamp-6">
                    {selectedSession.answer}
                  </p>
                </div>

                <ConfidenceMeter
                  score={selectedSession.confidence}
                  label={`Based on ${selectedSession.sources.length} sources`}
                />

                <div>
                  <h4 className="text-sm font-medium mb-2">Sources</h4>
                  <div className="space-y-2">
                    {selectedSession.sources?.slice(0, 3).map((source, i) => {
                      const sourceTitle =
                        source.title || source.title || "Unknown source";

                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <div className="h-2 w-2 rounded-full bg-primary" />
                          <span className="truncate">{sourceTitle}</span>
                        </div>
                      );
                    })}
                    {selectedSession.sources?.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{selectedSession.sources.length - 3} more
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button asChild className="flex-1">
                    <Link href={`/research?session=${selectedSession.id}`}>
                      View Full Result
                    </Link>
                  </Button>
                  <Button variant="outline" size="icon" asChild>
                    <Link
                      href={`/research?q=${encodeURIComponent(selectedSession.query)}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span className="sr-only">Repeat research</span>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Search className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground text-center">
                  Select a research session to view details
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}