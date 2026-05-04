"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  User,
  Settings,
  Key,
  Server,
  Trash2,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Sparkles,
  TrendingUp,
  Database,
  Brain,
  Clock,
  Activity,
  RefreshCw,
  Play,
  BarChart3,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { healthApi, HealthStatus, usersApi, mlApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const profileSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ProfileFormValues = z.infer<typeof profileSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;

// ML Dashboard Stats Types
interface MLStats {
  models: {
    total: number;
    ready: number;
    training: number;
  };
  predictions: {
    total: number;
    avg_time_ms: number;
  };
  recent_models: Array<{
    model_id: number;
    name: string;
    type: string;
    version: string;
    created_at: string;
    test_accuracy?: number;
    test_r2?: number;
    silhouette_score?: number;
  }>;
  most_used_models: Array<{
    name: string;
    predictions: number;
  }>;
}

interface MLModel {
  id: number;
  name: string;
  model_type: string;
  algorithm: string;
  version: string;
  status: string;
  created_at: string;
  metrics: Array<{ name: string; value: number }>;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const isSuperuser = user?.is_superuser || false;

  // ML Dashboard State
  const [mlStats, setMlStats] = useState<MLStats | null>(null);
  const [models, setModels] = useState<MLModel[]>([]);
  const [isLoadingML, setIsLoadingML] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [selectedModelType, setSelectedModelType] = useState<string>("all");

  // Research preferences
  const [defaultSources, setDefaultSources] = useState(5);
  const [providerOrder, setProviderOrder] = useState<"local" | "cloud">(
    "local",
  );
  const [autoFallback, setAutoFallback] = useState(true);
  const [autoIndex, setAutoIndex] = useState(true);

  // API configuration
  const [ollamaEndpoint, setOllamaEndpoint] = useState(
    "http://localhost:11434",
  );
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);

  // Health status
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.first_name || "",
      lastName: user?.last_name || "",
      email: user?.email || "",
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (user) {
      profileForm.reset({
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
      });
    }
  }, [user, profileForm]);

  useEffect(() => {
    if (isSuperuser && activeTab === "ml") {
      loadMLData();
    }
  }, [isSuperuser, activeTab]);

  const loadMLData = async () => {
    setIsLoadingML(true);
    try {
      // Load ML stats
      const statsResult = await mlApi.getDashboardStats();
      if (statsResult.data) {
        setMlStats(statsResult.data);
      }

      // Load models list
      const modelsResult = await mlApi.listModels(0, 100);
      if (modelsResult.data) {
        setModels(modelsResult.data);
      }
      
      toast.success("ML data refreshed");
    } catch (error) {
      console.error("Failed to load ML data:", error);
      toast.error("Failed to load ML dashboard data");
    } finally {
      setIsLoadingML(false);
    }
  };

  const handleTrainModels = async () => {
    setIsTraining(true);
    try {
      const result = await mlApi.trainModels();
      if (result.data) {
        toast.success("Model training started in background");
        // Refresh stats after training completes - poll every 5 seconds for up to 2 minutes
        let attempts = 0;
        const maxAttempts = 24; // 2 minutes
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const statsResult = await mlApi.getDashboardStats();
            if (statsResult.data) {
              const newTotalModels = statsResult.data.models.total;
              const oldTotalModels = mlStats?.models.total || 0;
              if (newTotalModels > oldTotalModels || attempts >= maxAttempts) {
                // Models have been updated or timeout reached
                clearInterval(pollInterval);
                loadMLData();
              }
            }
          } catch (error) {
            console.error("Error polling for training completion:", error);
          }
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            loadMLData(); // Final refresh even if no change detected
          }
        }, 5000); // Poll every 5 seconds
      }
    } catch (error) {
      console.error("Failed to start training:", error);
      toast.error("Failed to start model training");
    } finally {
      setIsTraining(false);
    }
  };

  const handleActivateModel = async (modelId: number) => {
    try {
      const result = await mlApi.activateModel(modelId);
      if (result.data) {
        toast.success(result.data.message);
        loadMLData();
      }
    } catch (error) {
      console.error("Failed to activate model:", error);
      toast.error("Failed to activate model");
    }
  };

  const testConnection = async () => {
    setIsTestingConnection(true);
    const { data, error } = await healthApi.check();
    if (error) {
      toast.error("Failed to check connection");
    } else if (data) {
      setHealthStatus(data);
      toast.success("Connection tested");
    }
    setIsTestingConnection(false);
  };

  const onProfileSubmit = async (data: ProfileFormValues) => {
    if (!user) return;

    const { data: result, error } = await usersApi.update(user.id, {
      first_name: data.firstName,
      last_name: data.lastName,
    });

    if (error) {
      toast.error(error);
      return;
    }

    await refreshUser();
    toast.success("Profile updated successfully");
  };

  const onPasswordSubmit = async (data: PasswordFormValues) => {
    const { data: result, error } = await usersApi.changePassword({
      current_password: data.currentPassword,
      new_password: data.newPassword,
    });

    if (error) {
      toast.error(error);
      return;
    }

    toast.success(result?.message || "Password updated successfully");
    passwordForm.reset();
  };

  const saveResearchPreferences = () => {
    toast.success("Research preferences saved");
  };

  const saveAPIConfiguration = () => {
    toast.success("API configuration saved");
  };

  const handleDeleteAccount = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    toast.success("Account deleted");
    await logout();
    router.push("/login");
  };

  const initials = user
    ? `${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase() ||
      "U"
    : "U";

  // Filter models by type
  const filteredModels =
    selectedModelType === "all"
      ? models
      : models.filter((m) => m.model_type === selectedModelType);

  return (
    <div className="container py-8 px-4 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and application preferences
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-8">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          {isSuperuser && (
            <>
              <TabsTrigger value="ml" className="gap-2">
                <Brain className="h-4 w-4" />
                ML Models
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Profile Settings */}
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...profileForm}>
                <form
                  onSubmit={profileForm.handleSubmit(onProfileSubmit)}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-6">
                    <Avatar className="h-20 w-20">
                      <AvatarImage
                        src={user?.avatar}
                        alt={
                          user ? `${user.first_name} ${user.last_name}` : "User"
                        }
                      />
                      <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={profileForm.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={profileForm.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} disabled />
                        </FormControl>
                        <FormDescription>
                          Contact an administrator to change your email
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={profileForm.formState.isSubmitting}
                  >
                    {profileForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...passwordForm}>
                <form
                  onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={passwordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm New Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={passwordForm.formState.isSubmitting}
                  >
                    {passwordForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Update Password"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ML Models Dashboard */}
        {isSuperuser && (
          <TabsContent value="ml" className="space-y-6">
            {/* Training Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  ML Model Training
                </CardTitle>
                <CardDescription>
                  Train machine learning models for book classification,
                  popularity prediction, and clustering
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Button
                    onClick={handleTrainModels}
                    disabled={isTraining}
                    className="gap-2"
                  >
                    {isTraining ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Training Started...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Train All Models
                      </>
                    )}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Training runs in background. Models will be available when
                    complete.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Stats Cards */}
            {mlStats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Models
                        </p>
                        <p className="text-2xl font-bold">
                          {mlStats.models.total}
                        </p>
                      </div>
                      <Layers className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Ready Models
                        </p>
                        <p className="text-2xl font-bold text-emerald-500">
                          {mlStats.models.ready}
                        </p>
                      </div>
                      <CheckCircle className="h-8 w-8 text-emerald-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Predictions
                        </p>
                        <p className="text-2xl font-bold">
                          {mlStats.predictions.total}
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Avg. Prediction Time
                        </p>
                        <p className="text-2xl font-bold">
                          {mlStats.predictions.avg_time_ms.toFixed(1)}ms
                        </p>
                      </div>
                      <Clock className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Model List */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5 text-primary" />
                      Trained Models
                    </CardTitle>
                    <CardDescription>
                      View and manage all trained ML models
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedModelType}
                      onValueChange={setSelectedModelType}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Models</SelectItem>
                        <SelectItem value="classification">
                          Classification
                        </SelectItem>
                        <SelectItem value="regression">Regression</SelectItem>
                        <SelectItem value="clustering">Clustering</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={loadMLData}
                      disabled={isLoadingML}
                    >
                      <RefreshCw
                        className={cn("h-4 w-4", isLoadingML && "animate-spin")}
                      />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingML ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-4 rounded-lg border animate-pulse"
                      >
                        <div className="space-y-2">
                          <div className="h-5 w-32 bg-muted rounded" />
                          <div className="h-4 w-24 bg-muted rounded" />
                        </div>
                        <div className="h-8 w-24 bg-muted rounded" />
                      </div>
                    ))}
                  </div>
                ) : filteredModels.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No models trained yet</p>
                    <p className="text-sm mt-1">
                      Click "Train All Models" to get started
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredModels.map((model) => {
                      const metric = model.metrics[0]; // only one key metric now
                      const metricLabel: Record<string, string> = {
                        test_accuracy: "Accuracy",
                        test_r2: "R²",
                        silhouette_score: "Silhouette",
                      };

                      return (
                        <div
                          key={model.id}
                          className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/5 transition-colors"
                        >
                          {/* Left: name + badges */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-foreground truncate">
                                {model.name}
                              </h3>
                              <Badge
                                variant="outline"
                                className="text-xs shrink-0"
                              >
                                {model.model_type}
                              </Badge>
                              <Badge
                                variant={
                                  model.status === "active"
                                    ? "default"
                                    : "secondary"
                                }
                                className={cn(
                                  "shrink-0",
                                  model.status === "active" &&
                                    "bg-emerald-500 hover:bg-emerald-600",
                                )}
                              >
                                {model.status}
                              </Badge>
                            </div>

                            {/* Second line: compact metadata */}
                            <p className="mt-1 text-xs text-muted-foreground truncate">
                              {model.algorithm} &middot; v{model.version}{" "}
                              &middot; Trained{" "}
                              {new Date(model.created_at).toLocaleString()}
                              {metric && (
                                <>
                                  {" "}
                                  &middot;{" "}
                                  <span className="font-medium text-foreground">
                                    {metricLabel[metric.name] ?? metric.name}:{" "}
                                    {metric.value.toFixed(3)}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>

                          {/* Right: activate button */}
                          {model.status !== "active" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-4 shrink-0"
                              onClick={() => handleActivateModel(model.id)}
                            >
                              Activate
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Most Used Models */}
            {mlStats && mlStats.most_used_models.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Most Used Models
                  </CardTitle>
                  <CardDescription>
                    Models with the highest prediction counts
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {mlStats.most_used_models.map((model) => (
                      <div
                        key={model.name}
                        className="flex items-center justify-between p-2"
                      >
                        <span className="font-medium">{model.name}</span>
                        <Badge variant="secondary">
                          {model.predictions} predictions
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
