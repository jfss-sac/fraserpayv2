
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    // Function to check if the device is mobile based on screen width
    const checkIfMobile = () => {
      return window.innerWidth < MOBILE_BREAKPOINT
    }

    // Initial check
    setIsMobile(checkIfMobile())

    // Setup the media query listener
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    
    // Create a handler for media query changes
    const onChange = () => {
      setIsMobile(checkIfMobile())
    }
    
    // Add event listeners for both media query and resize (as fallback)
    mql.addEventListener("change", onChange)
    window.addEventListener("resize", onChange)
    
    // Cleanup listeners on component unmount
    return () => {
      mql.removeEventListener("change", onChange)
      window.removeEventListener("resize", onChange)
    }
  }, [])

  // Ensure we always return a boolean, with a sensible default if detection is still in progress
  return isMobile === undefined ? false : isMobile
}
