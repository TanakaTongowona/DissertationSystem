"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  BookOpen,
  Clock,
  HardDrive,
  Sparkles,
  ArrowRight,
  Library,
  RefreshCw,
  Activity,
  BarChart3,
  TrendingUp,
  Users,
  Calendar,
  BookMarked,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SourceBadge } from "@/components/source-badge";
import { useAuth } from "@/lib/auth-context";
import {
  booksApi,
  researchApi,
  dashboardApi,
  LibraryStats,
  ResearchSession,
  DashboardOverview,
} from "@/lib/api";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
  "#82CA9D",
];

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [recentHistory, setRecentHistory] = useState<ResearchSession[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardOverview | null>(
    null,
  );
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);

  // Check if user is superuser
  const isSuperuser = user?.is_superuser || false;

  useEffect(() => {
    async function loadData() {
      const [statsResult, historyResult, dashboardResult] = await Promise.all([
        booksApi.stats(),
        researchApi.getHistory(),
        dashboardApi.getOverview(),
      ]);

      if (statsResult.data) {
        setStats(statsResult.data);
      }
      setIsLoadingStats(false);

      if (historyResult.data) {
        setRecentHistory(historyResult.data.slice(0, 5));
      }
      setIsLoadingHistory(false);

      if (dashboardResult.data) {
        setDashboardData(dashboardResult.data);
      }
      setIsLoadingAnalytics(false);
    }

    loadData();
  }, []);

  const handleResearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/research?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div className="container py-8 px-4 max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Welcome{user?.first_name ? `, ${user.first_name}` : ""}
        </h1>
        <p className="text-muted-foreground">
          Start a new research query or explore analytics about your library.
        </p>
        {isSuperuser && (
          <Badge className="mt-2 bg-primary/10 text-primary hover:bg-primary/20">
            Superuser
          </Badge>
        )}
      </div>

      {/* Quick Research Bar */}
      <Card className="mb-8 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="pt-6">
          <form onSubmit={handleResearch} className="space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask a research question..."
                className="h-14 pl-12 pr-4 text-lg bg-background border-border"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" className="gap-2">
                <Sparkles className="h-4 w-4" />
                Deep Research
              </Button>
              <Button type="button" variant="outline" size="lg" asChild>
                <Link href="/library" className="gap-2">
                  <Library className="h-4 w-4" />
                  Browse Library
                </Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Books
            </CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.total_books || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Research Sessions
            </CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {dashboardData?.research_activity.total_sessions || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Indexed Books
            </CardTitle>
            <BookMarked className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {dashboardData?.library_stats.indexed_books || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Library Size
            </CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {formatBytes(stats?.total_size_kb || 0)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Recent Activity and Analytics */}
      <Tabs defaultValue="activity" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="activity" className="gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </TabsTrigger>
           {isSuperuser && (
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
           )}
        </TabsList>

        {/* Recent Activity Tab */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Research Activity</CardTitle>
                <CardDescription>
                  Your latest research queries and sessions
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/history" className="gap-1">
                  View all
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentHistory.length > 0 ? (
                <div className="space-y-4">
                  {recentHistory.map((session) => (
                    <Link
                      key={session.id}
                      href={`/research?session=${session.id}`}
                      className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Search className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                          {session.query}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {formatDate(session.created_at)}
                          </span>
                          <SourceBadge type={session.source_type} />
                          {session.confidence && (
                            <Badge variant="outline" className="text-xs">
                              Confidence:{" "}
                              {(session.confidence * 100).toFixed(0)}%
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span className="sr-only">Repeat research</span>
                      </Button>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mx-auto mb-4">
                    <Search className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-foreground mb-1">
                    No research yet
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Start by asking a research question above.
                  </p>
                  {isSuperuser ? (
                    <Button asChild>
                      <Link href="/library">Upload a book</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline">
                      <Link href="/library">Browse available books</Link>
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          {isLoadingAnalytics ? (
            <div className="space-y-4">
              <Skeleton className="h-[300px] w-full" />
              <Skeleton className="h-[300px] w-full" />
              <Skeleton className="h-[300px] w-full" />
            </div>
          ) : dashboardData ? (
            <>
              {/* Indexing Progress */}
              <Card>
                <CardHeader>
                  <CardTitle>Indexing Progress</CardTitle>
                  <CardDescription>Books indexed vs pending</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span>Progress</span>
                      <span>
                        {dashboardData.indexing_progress.indexed_percentage.toFixed(
                          1,
                        )}
                        %
                      </span>
                    </div>
                    <Progress
                      value={dashboardData.indexing_progress.indexed_percentage}
                    />
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="text-center p-4 bg-primary/5 rounded-lg">
                        <div className="text-2xl font-bold text-primary">
                          {dashboardData.indexing_progress.indexed_count}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Indexed Books
                        </div>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <div className="text-2xl font-bold">
                          {dashboardData.indexing_progress.pending_count}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Pending Indexing
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Popular Subjects and Research Activity - Side by Side */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Popular Subjects */}
                {dashboardData.popular_subjects.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Popular Subjects</CardTitle>
                      <CardDescription>
                        Most common subjects in your library
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={dashboardData.popular_subjects.slice(0, 6)}
                            dataKey="count"
                            nameKey="subject"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label
                          >
                            {dashboardData.popular_subjects
                              .slice(0, 6)
                              .map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={COLORS[index % COLORS.length]}
                                />
                              ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {/* Research Activity */}
                <Card>
                  <CardHeader>
                    <CardTitle>Research Activity</CardTitle>
                    <CardDescription>
                      Your research patterns and confidence levels
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-sm text-muted-foreground">
                          Average Confidence
                        </div>
                        <div className="text-3xl font-bold">
                          {(
                            dashboardData.research_activity.avg_confidence * 100
                          ).toFixed(1)}
                          %
                        </div>
                        <Progress
                          value={
                            dashboardData.research_activity.avg_confidence * 100
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm text-muted-foreground">
                          Sessions (Last 30 Days)
                        </div>
                        <div className="text-3xl font-bold">
                          {
                            dashboardData.research_activity
                              .sessions_last_30_days
                          }
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Total:{" "}
                          {dashboardData.research_activity.total_sessions}
                        </div>
                      </div>
                    </div>

                    {/* Research Methods */}
                    {Object.keys(
                      dashboardData.research_activity.popular_research_methods,
                    ).length > 0 && (
                      <div className="mt-6">
                        <div className="text-sm font-medium mb-3">
                          Research Methods Used
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(
                            dashboardData.research_activity
                              .popular_research_methods,
                          ).map(([method, count]) => (
                            <Badge
                              key={method}
                              variant="secondary"
                              className="text-sm"
                            >
                              {method}: {count}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Most Used Providers */}
                    {Object.keys(
                      dashboardData.research_activity.most_used_providers,
                    ).length > 0 && (
                      <div className="mt-6">
                        <div className="text-sm font-medium mb-3">
                          Most Used Providers
                        </div>
                        <div className="space-y-2">
                          {Object.entries(
                            dashboardData.research_activity.most_used_providers,
                          )
                            .slice(0, 5)
                            .map(([provider, count]) => (
                              <div
                                key={provider}
                                className="flex items-center justify-between"
                              >
                                <span className="text-sm">{provider}</span>
                                <span className="text-sm font-medium">
                                  {count}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Library Growth Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Library Growth</CardTitle>
                  <CardDescription>Books added over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={dashboardData.book_growth}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stackId="1"
                        stroke="#8884d8"
                        fill="#8884d8"
                        name="New Books"
                      />
                      <Area
                        type="monotone"
                        dataKey="cumulative"
                        stackId="2"
                        stroke="#82ca9d"
                        fill="#82ca9d"
                        name="Total Books"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Popular Authors */}
              <Card>
                <CardHeader>
                  <CardTitle>Top Authors</CardTitle>
                  <CardDescription>
                    Most prolific authors in your library
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart
                      data={dashboardData.popular_authors.slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 100 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="author" type="category" width={100} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="book_count"
                        fill="#8884d8"
                        name="Total Books"
                      />
                      <Bar
                        dataKey="indexed_count"
                        fill="#82ca9d"
                        name="Indexed"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Publication Timeline */}
              <Card>
                <CardHeader>
                  <CardTitle>Publication Timeline</CardTitle>
                  <CardDescription>Books by publication decade</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dashboardData.publication_timeline}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="decade" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="book_count"
                        fill="#8884d8"
                        name="Total Books"
                      />
                      <Bar
                        dataKey="indexed_count"
                        fill="#82ca9d"
                        name="Indexed"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              
            </>
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">
                  No analytics data available yet.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Start uploading books and conducting research to see insights.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
