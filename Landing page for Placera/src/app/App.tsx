import { useState } from 'react';
import { Sparkles, Clock, Target, TrendingUp, CheckCircle, ArrowRight, Play } from 'lucide-react';
import { ImageWithFallback } from './components/figma/ImageWithFallback';
import { PlaceraLogo } from './components/PlaceraLogo';

export default function App() {
  const [isStarting, setIsStarting] = useState(false);

  const handleStartInterview = () => {
    setIsStarting(true);
    setTimeout(() => {
      alert('Interview generation feature coming soon!');
      setIsStarting(false);
    }, 1000);
  };

  return (
    <div className="size-full overflow-y-auto bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PlaceraLogo className="w-10 h-10" showText={true} />
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">FREE</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-slate-600 hover:text-slate-900 transition-colors">Features</a>
            <a href="#how-it-works" className="text-slate-600 hover:text-slate-900 transition-colors">How It Works</a>
            <button
              onClick={handleStartInterview}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative py-24 px-6 overflow-hidden">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm">AI-Powered Interview Platform</span>
              <span className="px-2 py-0.5 bg-green-500 text-white text-xs font-bold rounded-full ml-2">100% FREE</span>
            </div>

            <h1 className="text-5xl lg:text-6xl font-bold text-slate-900 leading-tight">
              Master Your Next Interview with{' '}
              <span className="text-blue-600">AI Precision</span>
            </h1>

            <p className="text-xl text-slate-600 leading-relaxed">
              Placera uses advanced AI to simulate real interview scenarios, provide instant feedback, and help you land your dream job with confidence.
            </p>

            <div className="flex gap-4">
              <button
                onClick={handleStartInterview}
                disabled={isStarting}
                className="group px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 flex items-center gap-2"
              >
                {isStarting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    Start Mock Interview
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <button className="px-8 py-4 border-2 border-slate-300 text-slate-700 rounded-lg hover:border-slate-400 hover:bg-white transition-all">
                Watch Demo
              </button>
            </div>

            <div className="flex items-center gap-8 pt-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-slate-600">No Credit Card Required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-slate-600">Instant Access</span>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/20 to-purple-600/20 rounded-3xl blur-3xl" />
            <ImageWithFallback
              src="https://images.unsplash.com/photo-1742459785723-667110cf8326?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHw1fHxwcm9mZXNzaW9uYWwlMjBpbnRlcnZpZXclMjBBSSUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzc2NDU2OTc3fDA&ixlib=rb-4.1.0&q=80&w=1080"
              alt="AI Interview Assistant"
              className="relative rounded-3xl shadow-2xl w-full"
            />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              Why Choose Placera?
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Our AI-powered platform provides everything you need to ace your interviews
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="p-6 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">AI-Powered Questions</h3>
              <p className="text-slate-600">
                Dynamic question generation tailored to your industry and experience level
              </p>
            </div>

            <div className="p-6 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Instant Feedback</h3>
              <p className="text-slate-600">
                Get real-time analysis of your answers with actionable improvement tips
              </p>
            </div>

            <div className="p-6 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <Clock className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Practice Anytime</h3>
              <p className="text-slate-600">
                24/7 access to unlimited mock interviews at your own pace
              </p>
            </div>

            <div className="p-6 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-orange-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Track Progress</h3>
              <p className="text-slate-600">
                Monitor your improvement with detailed analytics and performance metrics
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 px-6 bg-slate-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              How Placera Works
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Get interview-ready in three simple steps
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="relative">
              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold mb-6">
                  1
                </div>
                <ImageWithFallback
                  src="https://images.unsplash.com/photo-1763718432504-7716caff6e99?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBpbnRlcnZpZXclMjBBSSUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzc2NDU2OTc3fDA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="Set Up Profile"
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
                <h3 className="text-2xl font-bold text-slate-900 mb-3">Set Up Your Profile</h3>
                <p className="text-slate-600">
                  Tell us about your target role, industry, and experience level for personalized interviews
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold mb-6">
                  2
                </div>
                <ImageWithFallback
                  src="https://images.unsplash.com/photo-1681569685382-e75f0301584e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwyfHxwcm9mZXNzaW9uYWwlMjBpbnRlcnZpZXclMjBBSSUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzc2NDU2OTc3fDA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="Practice Interview"
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
                <h3 className="text-2xl font-bold text-slate-900 mb-3">Practice with AI</h3>
                <p className="text-slate-600">
                  Engage in realistic mock interviews with our advanced AI interviewer
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold mb-6">
                  3
                </div>
                <ImageWithFallback
                  src="https://images.unsplash.com/photo-1621533463370-837f20c6c889?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwzfHxwcm9mZXNzaW9uYWwlMjBpbnRlcnZpZXclMjBBSSUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzc2NDU2OTc3fDA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="Get Feedback"
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
                <h3 className="text-2xl font-bold text-slate-900 mb-3">Review & Improve</h3>
                <p className="text-slate-600">
                  Get detailed feedback and insights to refine your answers and boost confidence
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-6 bg-blue-600 text-white">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-8 text-center">
          <div>
            <div className="text-5xl font-bold mb-2">10K+</div>
            <div className="text-blue-100">Active Users</div>
          </div>
          <div>
            <div className="text-5xl font-bold mb-2">50K+</div>
            <div className="text-blue-100">Interviews Conducted</div>
          </div>
          <div>
            <div className="text-5xl font-bold mb-2">85%</div>
            <div className="text-blue-100">Success Rate</div>
          </div>
          <div>
            <div className="text-5xl font-bold mb-2">4.9/5</div>
            <div className="text-blue-100">User Rating</div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
            Ready to Ace Your Next Interview?
          </h2>
          <p className="text-xl text-slate-600 mb-8">
            Join thousands of professionals who have improved their interview skills with Placera
          </p>
          <button
            onClick={handleStartInterview}
            disabled={isStarting}
            className="group px-10 py-5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-xl hover:shadow-2xl disabled:opacity-50 inline-flex items-center gap-3 text-lg"
          >
            {isStarting ? (
              <>
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting Your Interview...
              </>
            ) : (
              <>
                Start Your Mock Interview
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-slate-900 text-slate-300">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-8">
          <div>
            <PlaceraLogo className="w-8 h-8" showText={true} />
            <p className="text-sm mt-4">
              Your AI-powered interview preparation platform
            </p>
            <div className="mt-3">
              <span className="px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full">100% FREE</span>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-white mb-4">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Demo</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white mb-4">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white mb-4">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-slate-800 text-center text-sm">
          <p>&copy; 2026 Placera. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}