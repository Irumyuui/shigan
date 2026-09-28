#define DEBUG

class Widget
{
#if DEBUG
    void DebugOnly()
    {
    }
#else
    void ReleaseOnly()
    {
    }
#endif
}
